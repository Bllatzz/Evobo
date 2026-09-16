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

// "🏁 Resultado: 🟢 Green · +0,62u" / "🏁 Resultado: 🔴 Red · −1,00u" / "🏁
// Resultado: ⚪ Anulada · +0,00u" / "🏁 Resultado: 🔴½ Meio-red · −0,75u" / "🏁
// Resultado: 🟢½ Meio-green · +0,31u" — âncora no rótulo literal
// "Resultado:" (nunca usado por esse tipster pra outra coisa); o círculo
// colorido e o "½" antes da palavra são opcionais no match pra tolerar
// variação de formatação sem quebrar. "Meio-*" vem ANTES de "Green"/"Red"
// na alternativa pra nunca casar só a metade errada da palavra composta.
const RESULT_MARKER_RE = /🏁\s*Resultado:\s*(?:🟢|🔴|⚪)?½?\s*(Meio-Green|Meio-Red|Green|Red|Anulada)\b/i;

export function detectResultFromMarker(text: string | null | undefined): ResultSignal | null {
  if (!text) return null;
  const match = text.match(RESULT_MARKER_RE);
  if (!match) return null;
  const word = match[1]!.toLowerCase();
  if (word === "green") return "green";
  if (word === "red") return "red";
  if (word === "meio-green") return "meio-green";
  if (word === "meio-red") return "meio-red";
  return "reembolso"; // Anulada
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

/** Chamado pelo listener de mensagens editadas (ver index.ts) — só age nos
 * grupos cadastrados em RESULT_EMOJI_GROUP_NAMES/RESULT_MARKER_GROUP_NAMES.
 * Atualiza TODAS as TelegramTip da mensagem editada de uma vez — MAS só
 * quando a mensagem mapeia pra exatamente 1 tip. Nos grupos de
 * RESULT_MARKER_GROUP_NAMES, o formato ESCADA do Padovan junta pernas
 * INDEPENDENTES (odd/stake próprios cada uma, podem ganhar/perder cada
 * uma pro seu lado) na mesma mensagem — sem um exemplo real de como o
 * tipster marca resultado numa ESCADA editada (uma linha "Resultado" por
 * perna, ou só uma pra mensagem toda), aplicar um resultado só a todas de
 * uma vez arriscaria errar quem não teve o mesmo desfecho; por ora fica
 * pra revisão manual sempre que a mensagem tiver mais de 1 tip.
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
