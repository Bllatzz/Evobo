import { TEXT_SIMILARITY_THRESHOLD, textSimilarity } from "../betAnalytix/matchTips.js";
import type { TippyCall } from "./fetchCalls.js";

export type TippyMatchOutcome = { result: "green" | "red" | "reembolso" } | { needsReview: true } | null;

/** O Tippy lê o MESMO canal do Telegram, então a call nasce no mesmo segundo
 * da mensagem (0-3s em 200 pares conferidos contra tips já gradadas) — bem
 * mais apertado que a janela de ±12h do bet-analytix, que casa horário de
 * jogo com horário de tip. 2min só dá folga pra um atraso do Tippy. */
export const TIPPY_TIME_WINDOW_MS = 2 * 60 * 1000;
/** Odd e stake têm 2 casas nos dois lados, então "igual" é igual — meia
 * casa de tolerância só absorve o erro de ponto flutuante (0.01 exato pode
 * cair pra qualquer lado da comparação). */
export const TIPPY_ODD_TOLERANCE = 0.005;
export const TIPPY_STAKE_TOLERANCE = 0.005;
/** Quanto o melhor candidato precisa ganhar do segundo em semelhança de
 * texto pra desempatar duas calls com mesma odd/stake/horário (ex.: 2 pernas
 * de uma ESCADA com a mesma odd): 1,0 vs 0,24 e 0,73 vs 0,47 nos dados
 * reais — abaixo disso é ambíguo de verdade e vai pra revisão. */
export const TIPPY_TEXT_MARGIN = 0.15;
/** Lucro do Tippy é stake×(odd−1) / −stake / 0 quando o resultado é cheio;
 * fora disso (ex.: meio-green) o status sozinho mentiria. */
const PROFIT_TOLERANCE = 0.02;
/** Só a descarte "maioria não pegou" é filtro estatístico do registro
 * público — o resultado da call continua valendo (as 4 tips já gradadas que
 * só casam com calls assim concordam 100% com o Tippy). Uma call que o admin
 * do canal tirou do registro não é confiável pra gradar. */
const UNTRUSTED_DISCARD_REASON = "decisão do admin";

export type TippyTipToMatch = {
  match: string | null;
  selection: string | null;
  odd: number | null;
  unit: number | null;
  receivedAt: Date;
};

type CallOutcome = "green" | "red" | "reembolso" | "pending" | "suspect";

function outcomeOf(call: TippyCall): CallOutcome {
  if (call.status === "Pending") return "pending";

  const expectedProfit = call.status === "Won" ? call.stake * (call.odds - 1) : call.status === "Lost" ? -call.stake : 0;
  if (call.profit !== null && Math.abs(call.profit - expectedProfit) > PROFIT_TOLERANCE) return "suspect";

  return call.status === "Won" ? "green" : call.status === "Lost" ? "red" : "reembolso";
}

function pickByText(tip: TippyTipToMatch, candidates: TippyCall[]): TippyCall | null {
  const tipText = `${tip.match ?? ""} ${tip.selection ?? ""}`.trim();
  const scored = candidates
    .map((call) => ({ call, score: textSimilarity(tipText, `${call.event} ${call.selection}`) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0]!;
  const second = scored[1]!;
  if (best.score < TEXT_SIMILARITY_THRESHOLD || best.score - second.score < TIPPY_TEXT_MARGIN) return null;
  return best.call;
}

/**
 * `null` = nada resolvido ainda (nenhuma call correspondente, ou a call
 * ainda está "Pending") — tenta de novo na próxima rodada, nunca marca
 * "precisa revisar" só por isso. `{needsReview}` = ambiguidade de verdade:
 * calls candidatas com desfechos diferentes que o texto não separa, ou um
 * lucro incoerente com o status.
 *
 * Casa por odd + stake (unidade) + horário — o texto só entra pra desempatar,
 * porque uma tip múltipla lista todas as pernas e a call do Tippy só uma, o
 * que derrubaria a semelhança de texto de um match que já é certo.
 */
export function matchTipToTippy(tip: TippyTipToMatch, calls: TippyCall[]): TippyMatchOutcome {
  if (tip.odd === null || tip.unit === null) return null;
  const { odd, unit } = tip;
  const tipTime = tip.receivedAt.getTime();

  let candidates = calls.filter(
    (c) =>
      c.discardReason !== UNTRUSTED_DISCARD_REASON &&
      Math.abs(c.odds - odd) <= TIPPY_ODD_TOLERANCE &&
      Math.abs(c.stake - unit) <= TIPPY_STAKE_TOLERANCE &&
      Math.abs(c.at - tipTime) <= TIPPY_TIME_WINDOW_MS,
  );
  if (candidates.length === 0) return null;

  if (new Set(candidates.map(outcomeOf)).size > 1) {
    const best = pickByText(tip, candidates);
    if (!best) return { needsReview: true };
    candidates = [best];
  }

  const outcome = outcomeOf(candidates[0]!);
  if (outcome === "pending") return null;
  if (outcome === "suspect") return { needsReview: true };
  return { result: outcome };
}
