import { prisma } from "../db.js";
import { BANKROLL_BY_GROUP_NAME } from "./config.js";
import { fetchBankrollBets } from "./fetchBankroll.js";
import { matchTip } from "./matchTips.js";

export type DailyGradingResult = { groupsChecked: number; graded: number; needsReview: number };

/** Roda 1x/dia (ver o agendamento em index.ts) e sob demanda via
 * POST /admin/grade-now. Nunca mexe numa tip que já tem `result` !==
 * "pending" — só grada quando o match é confiável, e só marca
 * `needsReview` quando é ambíguo de verdade (ver matchTips.ts). Uma falha
 * ao buscar um bankroll não derruba os outros grupos. */
export async function runDailyGrading(): Promise<DailyGradingResult> {
  let graded = 0;
  let needsReview = 0;
  let groupsChecked = 0;

  for (const [groupName, bankrollId] of Object.entries(BANKROLL_BY_GROUP_NAME)) {
    const group = await prisma.telegramGroup.findFirst({ where: { name: groupName } });
    if (!group) continue;
    groupsChecked++;

    let bets;
    try {
      bets = await fetchBankrollBets(bankrollId);
    } catch (err) {
      console.error(`[bet-analytix] falha ao buscar bankroll ${bankrollId} (${groupName}):`, err);
      continue;
    }

    const pendingTips = await prisma.telegramTip.findMany({
      where: { groupId: group.id, result: "pending" },
      select: { id: true, match: true, selection: true, odd: true, receivedAt: true },
    });

    for (const tip of pendingTips) {
      const outcome = matchTip(
        { match: tip.match, selection: tip.selection, odd: tip.odd !== null ? Number(tip.odd) : null, receivedAt: tip.receivedAt },
        bets,
      );
      if (outcome === null) continue;

      if ("needsReview" in outcome) {
        await prisma.telegramTip.update({ where: { id: tip.id }, data: { needsReview: true } });
        needsReview++;
      } else {
        await prisma.telegramTip.update({ where: { id: tip.id }, data: { result: outcome.result, needsReview: false } });
        graded++;
      }
    }
  }

  return { groupsChecked, graded, needsReview };
}
