import type { TelegramClient } from "telegram";
import bigInt from "big-integer";
import { prisma } from "./db.js";
import { applyEditedMessageResult, countResultEmojis, RESULT_EMOJI_GROUP_NAMES } from "./resultFromEmoji.js";

// getMessages({ids}) já espera automaticamente 10s entre lotes acima de 300
// ids — mantém os lotes bem abaixo disso por segurança/margem.
const BATCH_SIZE = 100;
const MAX_UNMATCHED_SAMPLES = 20;

export type BackfillResultFromEmojiGroupResult = {
  group: string;
  checked: number;
  applied: number;
  /** Mensagens com ✅/❌ visível que MESMO ASSIM não bateram o critério (pra
   * diagnosticar contagem insuficiente, mistura dos dois emojis, ou um
   * caractere parecido mas diferente do emoji esperado) — cap de
   * MAX_UNMATCHED_SAMPLES por grupo pra não inchar a resposta. */
  unmatched: { messageId: number; greenCount: number; redCount: number; text: string }[];
};

/** Aplica o sinal ✅✅✅/❌❌❌ retroativamente nas mensagens JÁ IMPORTADAS dos
 * grupos de RESULT_EMOJI_GROUP_NAMES — cobre edições que o tipster já tinha
 * feito ANTES do listener ao vivo (resultFromEmoji.ts) existir. Busca o
 * texto ATUAL de cada mensagem direto do Telegram (getMessages sempre
 * retorna o estado mais recente, edições incluídas) e reusa a mesma lógica
 * do listener ao vivo. Reusa a sessão MTProto já conectada do worker —
 * nunca abrir uma 2ª conexão com a mesma TELEGRAM_SESSION. */
export async function backfillResultFromEmoji(
  client: TelegramClient,
): Promise<BackfillResultFromEmojiGroupResult[]> {
  const groups = await prisma.telegramGroup.findMany({
    where: { name: { in: [...RESULT_EMOJI_GROUP_NAMES] } },
  });

  const results: BackfillResultFromEmojiGroupResult[] = [];

  for (const group of groups) {
    const tips = await prisma.telegramTip.findMany({
      where: { groupId: group.id },
      select: { telegramMessageId: true },
      distinct: ["telegramMessageId"],
    });
    const ids = tips.map((t) => Number(t.telegramMessageId));

    let applied = 0;
    const unmatched: BackfillResultFromEmojiGroupResult["unmatched"] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const messages = await client.getMessages(bigInt(group.telegramChatId), { ids: batch });
      for (const message of messages) {
        if (!message) continue; // mensagem apagada — undefined no lugar dela
        const count = await applyEditedMessageResult(message.id, message.message, group);
        applied += count;

        if (count === 0 && unmatched.length < MAX_UNMATCHED_SAMPLES) {
          const { greenCount, redCount } = countResultEmojis(message.message);
          if (greenCount > 0 || redCount > 0) {
            unmatched.push({ messageId: message.id, greenCount, redCount, text: message.message ?? "" });
          }
        }
      }
    }

    results.push({ group: group.name, checked: ids.length, applied, unmatched });
  }

  return results;
}
