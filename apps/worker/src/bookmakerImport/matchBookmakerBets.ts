import type { ImportedBookmakerBet, TelegramTipResult } from "@evobo/shared-types";
import { textSimilarity, ODD_TOLERANCE, TIME_WINDOW_MS, TEXT_SIMILARITY_THRESHOLD } from "../betAnalytix/matchTips.js";

/** Nome de jogo é um sinal muito mais confiável que a descrição do mercado
 * (times são literais, o texto do mercado varia — dois nomes de times de
 * verdade batem ~1.0, times diferentes ficam bem abaixo disso mesmo com
 * pontuação/acento diferentes). Descoberto testando contra dados reais:
 * uma tip com `selection` vazio (comum) só tinha 4 tokens no nome do jogo,
 * curto demais pra competir na similaridade combinada contra a descrição
 * do mercado de OUTRA tip que coincidia em `escanteios`/`cartões`/etc por
 * acaso — misturar os dois textos deixava o jogo errado ganhar. */
export const GAME_SIMILARITY_THRESHOLD = 0.5;

export type CandidateTip = {
  id: string;
  match: string | null;
  selection: string | null;
  unit: number | null;
  odd: number | null;
  originalOdd: number | null;
  limit: number | null;
  currentResult: TelegramTipResult;
  receivedAt: Date;
};

export type BookmakerBetMatch = {
  tipId: string;
  match: string | null;
  selection: string | null;
  /** null quando não dá pra converter reais em unidade (sem unitValue configurado). */
  unit: number | null;
  odd: number;
  /** null quando o status não é um resultado (aberta/cashout) ou a tip já
   * tinha um result oficial diferente de "pending" (nunca sobrescreve). */
  result: TelegramTipResult | null;
};

export type BookmakerBetOutcome =
  | { kind: "matched"; value: BookmakerBetMatch }
  | { kind: "ambiguous"; candidates: CandidateTip[] }
  | { kind: "unmatched" };

function officialResultForStatus(status: ImportedBookmakerBet["status"]): TelegramTipResult | null {
  if (status === "ganha") return "green";
  if (status === "perdido") return "red";
  if (status === "cancelado") return "reembolso";
  return null; // "aberta" (ainda sem resultado) e "cashout" (não é green/red/reembolso puro)
}

/** Unidade que a tip "esperava" que fosse apostada em reais, já achatada
 * pelo limite de aposta da casa quando existir (mesma regra de
 * applyStakeLimit em routes.ts/reactionTake.ts — um "Limite de aposta"
 * mais baixo que a unidade sugerida explica um stake real menor, não é
 * sinal de divergência). null quando a tip não tem unidade sugerida (não
 * dá pra comparar). */
function expectedStakeReais(candidate: CandidateTip, unitValueReais: number): number | null {
  if (candidate.unit === null) return null;
  const unit = candidate.limit !== null ? Math.min(candidate.unit, candidate.limit / unitValueReais) : candidate.unit;
  return unit * unitValueReais;
}

/**
 * Casa UMA aposta real (extraída do histórico da casa pelo usuário, ver
 * shared-types ImportedBookmakerBetSchema) contra as tips candidatas
 * (mesmo grupo ou não — o texto+odd é quem decide, não o tipster). Nunca
 * toca no banco, só calcula — quem chama decide se grava (ver
 * POST /telegram-tips/import-bets).
 *
 * odd+texto+horário são obrigatórios (mesmo critério do bet-analytix,
 * `matchTips.ts`) pra entrar na lista de candidatos — exceto o horário
 * quando a aposta não traz `placedAt`. Com 2+ candidatos
 * restantes, desempata pela unidade implícita (stake real ÷ valor da
 * unidade do usuário) contra a unidade sugerida de cada um — sem
 * `unitValueReais`, não dá pra calcular essa distância, então TODOS os
 * candidatos voltam como "ambíguo" (única forma de ficar ambíguo depois do
 * primeiro filtro). Com `unitValueReais`, o desempate SEMPRE resolve pra
 * um candidato só (empate de verdade quebra pelo mais recente) — nunca
 * devolve ambíguo nesse caminho, por decisão explícita do usuário.
 */
export function matchBookmakerBet(
  bet: ImportedBookmakerBet,
  allCandidates: CandidateTip[],
  unitValueReais: number | null,
): BookmakerBetOutcome {
  const betText = `${bet.game ?? ""} ${bet.selection}`.trim();
  // Sem data (casa que não mostra quando a aposta foi feita, ex.: Bet365) a
  // janela de horário simplesmente não se aplica — odd + jogo/texto seguem
  // obrigatórios, e o empate entre candidatos continua resolvido pela unidade.
  const betTime = bet.placedAt ? new Date(bet.placedAt).getTime() : NaN;

  const candidates = allCandidates.filter((c) => {
    const oddMatches =
      (c.odd !== null && Math.abs(c.odd - bet.odd) <= ODD_TOLERANCE) ||
      (c.originalOdd !== null && Math.abs(c.originalOdd - bet.odd) <= ODD_TOLERANCE);
    if (!oddMatches) return false;
    if (!Number.isNaN(betTime) && Math.abs(c.receivedAt.getTime() - betTime) > TIME_WINDOW_MS) return false;

    // Nome do jogo é o sinal forte quando os dois lados têm um — ver
    // GAME_SIMILARITY_THRESHOLD. Só cai pro texto combinado (jogo+mercado)
    // quando falta jogo de um dos lados pra comparar.
    if (bet.game !== null && c.match !== null) return textSimilarity(bet.game, c.match) >= GAME_SIMILARITY_THRESHOLD;
    const tipText = `${c.match ?? ""} ${c.selection ?? ""}`.trim();
    // Tip sem NENHUM texto (nem jogo nem seleção) — comum em props de
    // jogador/loteria/individual escritos livre no Telegram (ex.: "Harry
    // Kane marcar") ou em prints cuja OCR não extraiu nada. Não dá pra
    // comparar texto nenhum, então odd+horário já filtrados acima viram o
    // único critério — seguro porque, com 2+ candidatos nessa situação, cai
    // no desempate por unidade implícita (ou "ambíguo" sem unitValueReais)
    // abaixo, nunca escolhe errado sem chance de revisão.
    if (tipText === "") return true;
    return textSimilarity(betText, tipText) >= TEXT_SIMILARITY_THRESHOLD;
  });

  if (candidates.length === 0) return { kind: "unmatched" };

  let winner = candidates[0]!;
  if (candidates.length > 1) {
    if (unitValueReais === null) return { kind: "ambiguous", candidates };

    let bestDistance = Infinity;
    for (const c of candidates) {
      const expected = expectedStakeReais(c, unitValueReais);
      const distance = expected === null ? Infinity : Math.abs(expected - bet.stakeReais);
      // Empate de verdade (mesma distância) fica com a tip mais recente —
      // candidates já não tem ordem garantida, então compara explicitamente.
      if (distance < bestDistance || (distance === bestDistance && c.receivedAt.getTime() > winner.receivedAt.getTime())) {
        bestDistance = distance;
        winner = c;
      }
    }
  }

  const unit = unitValueReais !== null ? Math.round((bet.stakeReais / unitValueReais) * 100) / 100 : null;
  const proposedResult = officialResultForStatus(bet.status);
  const result = proposedResult !== null && winner.currentResult === "pending" ? proposedResult : null;

  return {
    kind: "matched",
    value: { tipId: winner.id, match: winner.match, selection: winner.selection, unit, odd: bet.odd, result },
  };
}
