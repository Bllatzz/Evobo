import type { BetAnalytixBet } from "./fetchBankroll.js";
import { ODD_TOLERANCE, TIME_WINDOW_MS } from "./matchTips.js";
import { tunnelHeaders } from "../tunnelAuth.js";

/** Mesma infra do OCR (ollamaVision.ts): OLLAMA_URL é o túnel pro PC, e o
 * modelo já está lá — só que aqui o prompt é texto puro. Sem custo e sem cota. */
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_VISION_MODEL ?? "qwen2.5vl:7b";
const OLLAMA_TIMEOUT_MS = 90_000;
const MAX_CANDIDATES = 6;

export type LlmTip = {
  match: string | null;
  selection: string | null;
  bookmaker: string | null;
  odd: number;
  /** Stake esperado em R$ (unidade × valor da unidade do grupo) — dica pro
   * modelo entender que stake menor é limite da casa; null = sem dica. */
  expectedStake: number | null;
  receivedAt: Date;
};

/** Entradas do bet-analytix que PODEM ser a tip: já resolvidas, mesma odd e
 * dentro da janela — as mesmas exigências de matchTips.ts. Quem decide qual
 * (se alguma) é o modelo, porque os rótulos são apelidos e abreviações que
 * comparação de palavras não entende ("Berlim" = Union Berlin, "Barça" =
 * Barcelona, "G/A" = gol ou assistência). */
export function llmCandidates(tip: Pick<LlmTip, "odd" | "receivedAt">, bets: BetAnalytixBet[]): BetAnalytixBet[] {
  const tipTime = tip.receivedAt.getTime();
  return bets
    .filter((b) => b.state !== 0 && Math.abs(b.odds - tip.odd) <= ODD_TOLERANCE && Math.abs(b.date * 1000 - tipTime) <= TIME_WINDOW_MS)
    .sort((a, b) => Math.abs(a.date * 1000 - tipTime) - Math.abs(b.date * 1000 - tipTime))
    .slice(0, MAX_CANDIDATES);
}

const SYSTEM_PROMPT =
  "Você compara uma tip de um grupo de Telegram com apostas registradas numa planilha (bet-analytix). Todas as candidatas têm a mesma odd. " +
  "Diga qual candidata é EXATAMENTE a mesma aposta da tip (mesmo jogo E mesmo mercado/seleção), ou null se nenhuma for claramente a mesma. " +
  "Os rótulos da planilha são abreviados e usam apelidos: 'Barça'=Barcelona, 'SP'=São Paulo, 'Berlim'=Union Berlin, 'Lyon'=Olympique Lyonnais, 'G/A'=gol ou assistência, " +
  "'anytime'=marcar a qualquer momento, 'ML'=vencer, 'aumento <casa>'=aposta com odd turbinada nessa casa, 'Dupla/Tripla <casa> @odd'=múltipla daquela casa. " +
  "O stake da planilha pode ser MENOR que o esperado por limite da casa. Uma candidata de OUTRO jogo ou de outra linha/mercado (ex.: 3+ não é 'mais de 3.5') NÃO é a mesma aposta. " +
  "As linhas numéricas precisam ser EQUIVALENTES: '3+' significa 3 ou mais, 'mais de 3.5' significa 4 ou mais, '+2.5 gols' e '+3.5 gols' são apostas diferentes; se a linha diverge, NÃO é a mesma aposta. " +
  'Se houver qualquer dúvida, responda null. Responda só JSON: {"escolha": <número da candidata ou null>, "motivo": "<curto>"}';

function buildPrompt(tip: LlmTip, candidates: BetAnalytixBet[]): string {
  // Emoji de bandeira e afins não dizem nada e só poluem o jogo.
  const game = (tip.match ?? "").replace(/[^\p{L}\p{N}\s.\-x/+]/gu, "").trim() || "(sem jogo)";
  const stakeHint = tip.expectedStake !== null ? ` | stake esperado=R$ ${tip.expectedStake}` : "";
  const lines = [
    `TIP: jogo=${game} | seleção=${(tip.selection ?? "").replace(/\n/g, " / ")} | casa=${tip.bookmaker ?? "?"} | odd=${tip.odd}${stakeHint}`,
    "CANDIDATAS:",
  ];
  candidates.forEach((b, i) => lines.push(`  ${i}: "${b.label}" | odd ${b.odds} | stake R$ ${b.stake}`));
  return lines.join("\n");
}

/**
 * Pergunta ao modelo qual candidata é a tip. `null` = nenhuma (ou resposta
 * que não é um índice válido — qualquer coisa fora do combinado vale como
 * "sem certeza", nunca como chute). Erro de rede/timeout PROPAGA: o Ollama
 * (PC ligado + túnel) não estar de pé agora é transitório, e quem chama
 * deixa a tip em "precisa revisar" em vez de gradar sem o modelo.
 *
 * Medido (2026-09-21, qwen2.5vl:7b, 125 casos reais): 120 certos, 3
 * abstenções (vão pra revisão), 2 escolhas erradas — uma delas "mais de 3.5"
 * casada com "3+" (diferença de linha que o modelo de 7B não pega).
 */
export async function chooseEntry(tip: LlmTip, candidates: BetAnalytixBet[]): Promise<BetAnalytixBet | null> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tunnelHeaders() },
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: "json",
      options: { temperature: 0, num_ctx: 4096 },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(tip, candidates) },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama respondeu ${res.status} (transitório): ${detail.slice(0, 120)}`);
  }

  const json = (await res.json()) as { message?: { content?: string } };
  try {
    const parsed = JSON.parse(json.message?.content ?? "") as { escolha?: unknown };
    const idx = typeof parsed.escolha === "string" ? Number(parsed.escolha) : parsed.escolha;
    return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 && idx < candidates.length ? candidates[idx]! : null;
  } catch {
    return null;
  }
}
