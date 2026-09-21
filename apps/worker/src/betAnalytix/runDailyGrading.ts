import { prisma } from "../db.js";
import { BANKROLL_BY_GROUP_NAME, UNIT_VALUE_BY_GROUP_NAME } from "./config.js";
import { fetchBankrollBets, type BetAnalytixBet } from "./fetchBankroll.js";
import { chooseEntry, llmCandidates } from "./llmMatch.js";
import { matchTip } from "./matchTips.js";
import { runTippyGrading } from "../tippy/runTippyGrading.js";

export type DailyGradingResult = { groupsChecked: number; graded: number; needsReview: number };

/** Roda 1x/dia (ver o agendamento em index.ts) e sob demanda via
 * POST /admin/grade-now. Nunca mexe numa tip que já tem `result` !==
 * "pending" — só grada quando o match é confiável, e só marca
 * `needsReview` quando é ambíguo de verdade (ver matchTips.ts). Uma falha
 * ao buscar um bankroll não derruba os outros grupos. O que a comparação de
 * texto não resolve (apelidos, abreviações) o modelo local decide, ver
 * llmMatch.ts. Também roda o Tippy
 * (grupos com vitrine pública lá, ver tippy/runTippyGrading.ts) e soma os
 * dois — assim o botão do admin e o agendamento diário cobrem as duas
 * fontes sem mais nenhuma chamada. */
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
      select: { id: true, match: true, selection: true, odd: true, unit: true, bookmaker: true, receivedAt: true },
    });
    const unitValue = UNIT_VALUE_BY_GROUP_NAME[groupName];

    // `result: "pending"` no where: se o admin marcou à mão (ou o emoji/reação
    // chegou) entre o findMany e aqui, isso ganha — nunca pisa.
    const grade = async (id: string, result: "green" | "red") => {
      const { count } = await prisma.telegramTip.updateMany({ where: { id, result: "pending" }, data: { result, needsReview: false } });
      graded += count;
    };
    const flag = async (id: string) => {
      await prisma.telegramTip.update({ where: { id }, data: { needsReview: true } });
      needsReview++;
    };

    // Tips que a comparação de texto não resolveu mas têm entrada(s) com a
    // mesma odd na janela: quem decide é o modelo (llmMatch.ts), DEPOIS do
    // loop — pra poder garantir que uma entrada resolve uma tip só.
    const undecided: { tip: (typeof pendingTips)[number]; odd: number; candidates: BetAnalytixBet[] }[] = [];

    for (const tip of pendingTips) {
      const odd = tip.odd !== null ? Number(tip.odd) : null;
      const outcome = matchTip({ match: tip.match, selection: tip.selection, odd, receivedAt: tip.receivedAt }, bets);
      if (outcome === null) continue;

      if ("needsReview" in outcome) {
        const candidates = odd !== null ? llmCandidates({ odd, receivedAt: tip.receivedAt }, bets) : [];
        if (candidates.length > 0) undecided.push({ tip, odd: odd!, candidates });
        else await flag(tip.id);
      } else {
        await grade(tip.id, outcome.result);
      }
    }

    // Ollama fora do ar (PC desligado/túnel caído) é transitório: as tips
    // seguem "precisa revisar" e a próxima rodada tenta de novo.
    let modelDown = false;
    const chosen = new Map<string, BetAnalytixBet | null>();
    for (const u of undecided) {
      if (modelDown) {
        chosen.set(u.tip.id, null);
        continue;
      }
      try {
        chosen.set(
          u.tip.id,
          await chooseEntry(
            {
              match: u.tip.match,
              selection: u.tip.selection,
              bookmaker: u.tip.bookmaker,
              odd: u.odd,
              expectedStake: unitValue !== undefined && u.tip.unit !== null ? Number(u.tip.unit) * unitValue : null,
              receivedAt: u.tip.receivedAt,
            },
            u.candidates,
          ),
        );
      } catch (err) {
        console.error(`[bet-analytix] modelo indisponível (${groupName}) — tips seguem pra revisão:`, err);
        modelDown = true;
        chosen.set(u.tip.id, null);
      }
    }

    const entryKey = (b: BetAnalytixBet) => `${b.date}|${b.label}|${b.odds}|${b.stake}`;
    const timesChosen = new Map<string, number>();
    for (const entry of chosen.values()) if (entry) timesChosen.set(entryKey(entry), (timesChosen.get(entryKey(entry)) ?? 0) + 1);

    for (const u of undecided) {
      const entry = chosen.get(u.tip.id) ?? null;
      const resolved = entry !== null && timesChosen.get(entryKey(entry)) === 1 && (entry.state === 1 || entry.state === 2);
      if (resolved) {
        console.log(`[bet-analytix] ${u.tip.id} gradada ${entry.state === 1 ? "green" : "red"} pelo modelo (entrada "${entry.label}", stake ${entry.stake})`);
        await grade(u.tip.id, entry.state === 1 ? "green" : "red");
      } else {
        await flag(u.tip.id);
      }
    }
  }

  // Depois do bet-analytix (que depende do PC ligado) e isolado dele: se o
  // túnel estiver fora, as falhas acima só logam e o Tippy roda do mesmo jeito.
  const tippy = await runTippyGrading();
  return {
    groupsChecked: groupsChecked + tippy.groupsChecked,
    graded: graded + tippy.graded,
    needsReview: needsReview + tippy.needsReview,
  };
}
