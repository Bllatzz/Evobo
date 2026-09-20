import type { TelegramGroup } from "@prisma/client";
import { prisma } from "./db.js";

/** Grupos onde o tipster marca o resultado editando a própria mensagem
 * (3x ✅ = green, 3x ❌ = red) em vez de depender do bet-analytix — hoje só
 * o Super Odds faz isso. Fixo no código, mesmo padrão de
 * betAnalytix/config.ts (adicionar um grupo novo = adicionar uma linha aqui). */
export const RESULT_EMOJI_GROUP_NAMES = new Set(["ST - Super Odds de Valor"]);

/** Grupos onde o tipster marca o resultado editando a mensagem com uma linha
 * própria ("🏁 Resultado: 🟢 Green · +0,62u" / "🏁 Resultado: 🔴 Red ·
 * −1,00u") em vez do padrão 3x✅/3x❌ acima — hoje só o Padovan All Sports
 * (a "🏁 Resultado" da mensagem, não confundir com a linha "📊 Planilhada"
 * que parseTip.ts já ignora na hora de ler a tip original). Mesma convenção
 * de RESULT_EMOJI_GROUP_NAMES: adicionar um grupo novo = adicionar uma
 * linha aqui. */
export const RESULT_MARKER_GROUP_NAMES = new Set(["Padovan All Sports"]);

/** União dos dois — todo grupo onde alguma forma de edição sinaliza o
 * resultado (usado por quem precisa varrer/backfillar os dois de uma vez,
 * ver backfillResultFromEmoji.ts). */
export const RESULT_SIGNAL_GROUP_NAMES = new Set([...RESULT_EMOJI_GROUP_NAMES, ...RESULT_MARKER_GROUP_NAMES]);

const MIN_EMOJI_COUNT = 3;

function countOccurrences(text: string, char: string): number {
  return text.split(char).length - 1;
}

/** Exportado à parte de detectResultFromEmojis pra diagnóstico (ver
 * backfillResultFromEmoji.ts) — permite inspecionar POR QUE uma mensagem com
 * emoji visível não bateu (contagem insuficiente, mistura de ✅ e ❌, etc.)
 * em vez de só saber que deu null. */
export function countResultEmojis(text: string | null | undefined): { greenCount: number; redCount: number } {
  if (!text) return { greenCount: 0, redCount: 0 };
  return { greenCount: countOccurrences(text, "✅"), redCount: countOccurrences(text, "❌") };
}

/** null quando a edição não é um sinal de resultado reconhecível (edição de
 * outra coisa no texto, ou emojis insuficientes/misturados — exige pelo
 * menos 3 de um tipo e ZERO do outro, pra nunca confundir com um emoji solto
 * usado por outro motivo). */
export function detectResultFromEmojis(text: string | null | undefined): "green" | "red" | null {
  const { greenCount, redCount } = countResultEmojis(text);
  if (greenCount >= MIN_EMOJI_COUNT && redCount === 0) return "green";
  if (redCount >= MIN_EMOJI_COUNT && greenCount === 0) return "red";
  return null;
}

export type ResultSignal = "green" | "red" | "reembolso" | "meio-green" | "meio-red";

// "🟢 Green" / "🔴 Red" / "⚪ Anulada" / "🔴½ Meio-red" / "🟢½ Meio-green" — o
// círculo colorido e o "½" antes da palavra são opcionais no match pra
// tolerar variação de formatação sem quebrar. "Meio-*" vem ANTES de
// "Green"/"Red" na alternativa pra nunca casar só a metade errada da
// palavra composta.
const RESULT_WORD_SRC = "(?:🟢|🔴|⚪)?½?\\s*(Meio-Green|Meio-Red|Green|Red|Anulada)\\b";

// "🏁 Resultado: 🟢 Green · +0,62u" / "🏁 Resultado: 🔴 Red · −1,00u" — âncora
// no rótulo literal "Resultado:" (nunca usado por esse tipster pra outra
// coisa).
const RESULT_MARKER_RE = new RegExp(`🏁\\s*Resultado:\\s*${RESULT_WORD_SRC}`, "i");

// Perna numerada de uma ESCADA / "N INDIVIDUAIS" editada, com o resultado no
// fim da própria linha: "1️⃣ Honest Ahanor 1+ faltas cometidas · 🟢 Green
// +0,72u" ou "1️⃣ AC Milan equipe com mais cartões · Lazio x AC Milan · 🟢
// Green +2,74u". O texto da perna é tudo entre o keycap e o ÚLTIMO " · "
// antes do resultado (guloso), então "·" dentro do texto não atrapalha.
const LEG_RESULT_RE = new RegExp(`^([0-9])️?⃣\\s*(.+)\\s*·\\s*${RESULT_WORD_SRC}`, "i");

function resultFromWord(word: string): ResultSignal {
  switch (word.toLowerCase()) {
    case "green":
      return "green";
    case "red":
      return "red";
    case "meio-green":
      return "meio-green";
    case "meio-red":
      return "meio-red";
    default:
      return "reembolso"; // Anulada
  }
}

export function detectResultFromMarker(text: string | null | undefined): ResultSignal | null {
  if (!text) return null;
  const match = text.match(RESULT_MARKER_RE);
  return match ? resultFromWord(match[1]!) : null;
}

export type LegResult = { position: number; text: string; result: ResultSignal };

/** Resultado por perna, pro formato em que o tipster edita CADA linha
 * numerada da ESCADA / "N INDIVIDUAIS" (sem linha "🏁 Resultado:"; o "🏁
 * Total" do fim é só a soma e é ignorado). Perna sem resultado ainda (jogo
 * não terminou) simplesmente não aparece — as demais valem do mesmo jeito. */
export function detectLegResults(text: string | null | undefined): LegResult[] {
  if (!text) return [];
  const legs: LegResult[] = [];
  for (const raw of text.split("\n")) {
    const match = raw.trim().match(LEG_RESULT_RE);
    if (!match) continue;
    legs.push({ position: Number(match[1]), text: match[2]!.trim(), result: resultFromWord(match[3]!) });
  }
  return legs;
}

/** Exportado à parte de applyEditedMessageResult pra diagnóstico (ver
 * backfillResultFromEmoji.ts) — permite distinguir "não achei sinal nenhum"
 * de "achei um sinal, mas não apliquei" (mensagem com mais de 1 tip, ou
 * `result` que já não estava "pending"). */
export function detectResult(text: string | null | undefined, groupName: string): ResultSignal | null {
  if (RESULT_EMOJI_GROUP_NAMES.has(groupName)) return detectResultFromEmojis(text);
  if (RESULT_MARKER_GROUP_NAMES.has(groupName)) return detectResultFromMarker(text);
  return null;
}

function normalizeLegText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Uma perna editada ("<seleção>" ou "<seleção> · <jogo>") aponta pra uma
 * tip quando o texto bate com `selection` — sozinho ou seguido do jogo
 * ("Lazio x AC Milan"), já que nas INDIVIDUAIS o tipster repete o confronto
 * na linha da perna editada. */
export function legMatchesTip(legText: string, tip: { selection: string | null; match: string | null }): boolean {
  const leg = normalizeLegText(legText);
  const selection = normalizeLegText(tip.selection);
  if (!leg || !selection) return false;
  if (leg === selection) return true;
  const match = normalizeLegText(tip.match);
  return match !== "" && leg === `${selection} · ${match}`;
}

/** Mensagem com várias pernas (ESCADA / N INDIVIDUAIS): cada linha numerada
 * ganha o próprio resultado, aplicado só à tip cujo texto bate com a perna.
 * As pernas de uma mesma mensagem são INDEPENDENTES (podem ter desfechos
 * diferentes), então nunca se aplica um resultado à mensagem toda — e uma
 * perna que não casa com EXATAMENTE 1 tip ainda pendente (0 ou ambígua) fica
 * de fora pra revisão manual, nunca chuta. */
async function applyLegResults(messageId: number, legs: LegResult[], group: TelegramGroup): Promise<number> {
  const tips = await prisma.telegramTip.findMany({
    where: { groupId: group.id, telegramMessageId: BigInt(messageId) },
    select: { id: true, selection: true, match: true, result: true },
  });

  let applied = 0;
  for (const leg of legs) {
    const candidates = tips.filter((t) => legMatchesTip(leg.text, t));
    if (candidates.length !== 1) continue;
    const tip = candidates[0]!;
    if (tip.result !== "pending") continue;

    const { count } = await prisma.telegramTip.updateMany({
      where: { id: tip.id, result: "pending" },
      data: { result: leg.result, needsReview: false },
    });
    if (count > 0) {
      applied += count;
      console.log(`[worker] resultado "${leg.result}" aplicado via edição da perna ${leg.position} (grupo ${group.name}, msg ${messageId})`);
    }
  }
  return applied;
}

/** Chamado pelo listener de mensagens editadas (ver index.ts) — só age nos
 * grupos cadastrados em RESULT_EMOJI_GROUP_NAMES/RESULT_MARKER_GROUP_NAMES.
 *
 * Duas formas de o tipster marcar resultado nos grupos de
 * RESULT_MARKER_GROUP_NAMES:
 *  - linha única "🏁 Resultado: ..." (mensagem de 1 tip): aplica a TODAS as
 *    tips da mensagem, MAS só quando ela mapeia pra exatamente 1 tip — se
 *    tiver mais, as pernas são independentes e um resultado só arriscaria
 *    errar quem não teve o mesmo desfecho (fica pra revisão manual);
 *  - resultado em cada perna numerada (ESCADA / N INDIVIDUAIS): aplicado
 *    perna a perna, ver applyLegResults.
 *
 * Nunca sobrescreve um `result` que já saiu de "pending" (proteção pra
 * marcação manual anterior) — como trade-off, isso também significa que
 * uma CORREÇÃO do tipster (editar de novo depois de já ter marcado errado)
 * não é reaplicada automaticamente; precisaria de reprocessamento manual. */
export async function applyEditedMessageResult(
  messageId: number,
  messageText: string | null | undefined,
  group: TelegramGroup,
): Promise<number> {
  if (RESULT_MARKER_GROUP_NAMES.has(group.name)) {
    const legs = detectLegResults(messageText);
    if (legs.length > 0) return applyLegResults(messageId, legs, group);
  }

  const result = detectResult(messageText, group.name);
  if (!result) return 0;

  if (RESULT_MARKER_GROUP_NAMES.has(group.name)) {
    const tipCount = await prisma.telegramTip.count({
      where: { groupId: group.id, telegramMessageId: BigInt(messageId) },
    });
    if (tipCount > 1) return 0;
  }

  const { count } = await prisma.telegramTip.updateMany({
    where: { groupId: group.id, telegramMessageId: BigInt(messageId), result: "pending" },
    data: { result, needsReview: false },
  });
  if (count > 0) {
    console.log(`[worker] resultado "${result}" aplicado via edição (grupo ${group.name}, msg ${messageId}) em ${count} tip(s)`);
  }
  return count;
}
