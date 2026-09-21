import { prisma } from "../db.js";
import type { DailyGradingResult } from "../betAnalytix/runDailyGrading.js";
import { TIPPY_TOKEN_ENV_BY_GROUP_NAME } from "./config.js";
import { fetchTippyCalls } from "./fetchCalls.js";
import { TIPPY_TIME_WINDOW_MS, matchTipToTippy } from "./matchTippyCalls.js";

/** Grada as tips pendentes dos grupos com vitrine pública no Tippy (hoje só
 * o Padovan NBA/NFL). Mesma regra do bet-analytix: nunca mexe numa tip que
 * já tem `result` !== "pending", e só marca `needsReview` quando é ambíguo de
 * verdade (ver matchTippyCalls.ts). Roda dentro de runDailyGrading (3h e
 * botão "Checar bet-analytix agora") E sozinha a cada poucos minutos — é um
 * `fetch` de ~230 KB, sem Chromium nem túnel, então não precisa esperar o
 * dia seguinte pra o resultado aparecer. Uma falha num grupo não derruba os
 * outros, e um token ausente só pula o grupo. */
export async function runTippyGrading(): Promise<DailyGradingResult> {
  let graded = 0;
  let needsReview = 0;
  let groupsChecked = 0;

  for (const [groupName, tokenEnv] of Object.entries(TIPPY_TOKEN_ENV_BY_GROUP_NAME)) {
    const token = process.env[tokenEnv];
    if (!token) {
      console.warn(`[tippy] ${tokenEnv} não configurado — pulando ${groupName}`);
      continue;
    }

    const group = await prisma.telegramGroup.findFirst({ where: { name: groupName } });
    if (!group) continue;
    groupsChecked++;

    const pendingTips = await prisma.telegramTip.findMany({
      where: { groupId: group.id, result: "pending" },
      select: { id: true, match: true, selection: true, odd: true, unit: true, receivedAt: true, needsReview: true },
    });
    if (pendingTips.length === 0) continue;

    const oldestMs = Math.min(...pendingTips.map((t) => t.receivedAt.getTime()));
    let calls;
    try {
      calls = await fetchTippyCalls(token, oldestMs - TIPPY_TIME_WINDOW_MS);
    } catch (err) {
      console.error(`[tippy] falha ao buscar as calls (${groupName}):`, err);
      continue;
    }

    for (const tip of pendingTips) {
      const outcome = matchTipToTippy(
        {
          match: tip.match,
          selection: tip.selection,
          odd: tip.odd !== null ? Number(tip.odd) : null,
          unit: tip.unit !== null ? Number(tip.unit) : null,
          receivedAt: tip.receivedAt,
        },
        calls,
      );
      if (outcome === null) continue;

      if ("needsReview" in outcome) {
        if (tip.needsReview) continue; // já sinalizada numa rodada anterior
        await prisma.telegramTip.updateMany({ where: { id: tip.id, result: "pending" }, data: { needsReview: true } });
        needsReview++;
      } else {
        // `result: "pending"` no where: se o admin marcou à mão (ou o emoji/
        // reação chegou) entre o findMany e aqui, isso ganha — nunca pisa.
        const { count } = await prisma.telegramTip.updateMany({
          where: { id: tip.id, result: "pending" },
          data: { result: outcome.result, needsReview: false },
        });
        graded += count;
      }
    }
  }

  return { groupsChecked, graded, needsReview };
}
