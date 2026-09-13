import type { TelegramGroup } from "@prisma/client";
import { prisma } from "./db.js";

/** Grupos onde o tipster marca o resultado editando a própria mensagem
 * (3x ✅ = green, 3x ❌ = red) em vez de depender do bet-analytix — hoje só
 * o Super Odds faz isso. Fixo no código, mesmo padrão de
 * betAnalytix/config.ts (adicionar um grupo novo = adicionar uma linha aqui). */
export const RESULT_EMOJI_GROUP_NAMES = new Set(["ST - Super Odds de Valor"]);

const MIN_EMOJI_COUNT = 3;

function countOccurrences(text: string, char: string): number {
  return text.split(char).length - 1;
}

/** null quando a edição não é um sinal de resultado reconhecível (edição de
 * outra coisa no texto, ou emojis insuficientes/misturados — exige pelo
 * menos 3 de um tipo e ZERO do outro, pra nunca confundir com um emoji solto
 * usado por outro motivo). */
export function detectResultFromEmojis(text: string | null | undefined): "green" | "red" | null {
  if (!text) return null;
  const greenCount = countOccurrences(text, "✅");
  const redCount = countOccurrences(text, "❌");
  if (greenCount >= MIN_EMOJI_COUNT && redCount === 0) return "green";
  if (redCount >= MIN_EMOJI_COUNT && greenCount === 0) return "red";
  return null;
}

/** Chamado pelo listener de mensagens editadas (ver index.ts) — só age nos
 * grupos cadastrados em RESULT_EMOJI_GROUP_NAMES. Atualiza TODAS as
 * TelegramTip da mensagem editada de uma vez (uma múltipla com N seleções
 * ainda é 1 mensagem só). O sinal do próprio tipster é tratado como
 * definitivo — sempre sobrescreve `result`, mesmo que já tenha um (uma
 * correção do tipster também chega editando de novo). */
export async function applyEditedMessageResult(
  messageId: number,
  messageText: string | null | undefined,
  group: TelegramGroup,
): Promise<number> {
  if (!RESULT_EMOJI_GROUP_NAMES.has(group.name)) return 0;

  const result = detectResultFromEmojis(messageText);
  if (!result) return 0;

  const { count } = await prisma.telegramTip.updateMany({
    where: { groupId: group.id, telegramMessageId: BigInt(messageId) },
    data: { result, needsReview: false },
  });
  if (count > 0) {
    console.log(`[worker] resultado "${result}" aplicado via edição (grupo ${group.name}, msg ${messageId}) em ${count} tip(s)`);
  }
  return count;
}
