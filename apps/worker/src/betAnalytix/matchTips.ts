import type { BetAnalytixBet } from "./fetchBankroll.js";

export type MatchOutcome = { result: "green" | "red" } | { needsReview: true } | null;

/** Odd/horário são objetivos e nunca sofrem com limite de casa — critério
 * forte. Unidade/stake propositalmente NÃO entra aqui: um "Limite de
 * aposta" na casa faz o stake real vir abaixo do pretendido, então usar
 * isso pra desqualificar um match derrubaria casos legítimos. */
export const ODD_TOLERANCE = 0.01;
export const TIME_WINDOW_MS = 12 * 60 * 60 * 1000;
/** Ponto de partida — ajustar depois de rodar contra dados reais (ver
 * plano/memória: "ajustar a tolerância se muita coisa cair em 'precisa
 * revisar' à toa"). */
export const TEXT_SIMILARITY_THRESHOLD = 0.3;

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jaccard sobre tokens — simples de propósito, dá pra trocar por algo
 * mais sofisticado depois que houver dados reais pra calibrar. */
export function textSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeText(a).split(" ").filter(Boolean));
  const setB = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const t of setA) if (setB.has(t)) overlap++;
  return overlap / (setA.size + setB.size - overlap);
}

/** "x"/"vs" aparecem em todo confronto — contam como palavra igual entre
 * jogos diferentes e inflariam a semelhança, então ficam de fora daqui. */
const GAME_STOP_TOKENS = new Set(["x", "vs", "v"]);

/** Semelhança só do CONFRONTO (times), ignorando o mercado: o bet-analytix
 * guarda apostas turbinadas como "Bahia x Remo aumento betano" — só jogo e
 * casa, nada do mercado — então o texto longo da seleção da tip ("+0.5 HT
 * Bahia ou Remo ganham HT e +3.5 Cards") sempre parece diferente delas. */
export function gameSimilarity(a: string, b: string): number {
  const tokens = (s: string) => new Set(normalizeText(s).split(" ").filter((t) => t && !GAME_STOP_TOKENS.has(t)));
  const setA = tokens(a);
  const setB = tokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const t of setA) if (setB.has(t)) overlap++;
  return overlap / (setA.size + setB.size - overlap);
}

export type TipToMatch = {
  match: string | null;
  selection: string | null;
  odd: number | null;
  receivedAt: Date;
};

/**
 * `null` = nada resolvido ainda no bet-analytix dentro da janela (o jogo
 * pode não ter acabado, ou o tipster ainda não logou) — tenta de novo
 * amanhã, nunca marca como "precisa revisar" só por isso. `{needsReview}` =
 * ambiguidade de verdade: candidatos resolvidos discordam entre si, OU o
 * único candidato tem semelhança de texto fraca demais pra confiar.
 */
export function matchTip(tip: TipToMatch, bets: BetAnalytixBet[]): MatchOutcome {
  if (tip.odd === null) return null;

  const tipText = `${tip.match ?? ""} ${tip.selection ?? ""}`.trim();
  const tipTime = tip.receivedAt.getTime();

  const candidates = bets.filter(
    (b) =>
      b.state !== 0 &&
      Math.abs(b.odds - tip.odd!) <= ODD_TOLERANCE &&
      Math.abs(b.date * 1000 - tipTime) <= TIME_WINDOW_MS,
  );
  if (candidates.length === 0) return null;

  const states = new Set(candidates.map((c) => c.state));
  if (states.size > 1) return { needsReview: true };

  // Mesmo jogo + mesma odd + dentro da janela já é um match forte (>95% pelo
  // critério do dono), então basta o jogo OU o texto todo se parecerem com o
  // rótulo — exigir o mercado também derrubava as apostas turbinadas.
  const bestSimilarity = Math.max(
    ...candidates.map((c) => Math.max(textSimilarity(tipText, c.label), tip.match ? gameSimilarity(tip.match, c.label) : 0)),
  );
  if (bestSimilarity < TEXT_SIMILARITY_THRESHOLD) return { needsReview: true };

  const state = candidates[0]!.state;
  if (state === 1) return { result: "green" };
  if (state === 2) return { result: "red" };
  return { needsReview: true }; // estado desconhecido (nunca visto 0/1/2) — não arrisca gradar
}
