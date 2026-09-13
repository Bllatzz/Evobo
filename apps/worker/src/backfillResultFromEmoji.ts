import type { TelegramClient } from "telegram";
import bigInt from "big-integer";
import { prisma } from "./db.js";
import { applyEditedMessageResult, RESULT_EMOJI_GROUP_NAMES } from "./resultFromEmoji.js";

// getMessages({ids}) já espera automaticamente 10s entre lotes acima de 300
// ids — mantém os lotes bem abaixo disso por segurança/margem.
const BATCH_SIZE = 100;

/** Aplica o sinal ✅✅✅/❌❌❌ retroativamente nas mensagens JÁ IMPORTADAS dos
 * grupos de RESULT_EMOJI_GROUP_NAMES — cobre edições que o tipster já tinha
 * feito ANTES do listener ao vivo (resultFromEmoji.ts) existir. Busca o
 * texto ATUAL de cada mensagem direto do Telegram (getMessages sempre
 * retorna o estado mais recente, edições incluídas) e reusa a mesma lógica
 * do listener ao vivo. Reusa a sessão MTProto já conectada do worker —
 * nunca abrir uma 2ª conexão com a mesma TELEGRAM_SESSION. */
export async function backfillResultFromEmoji(
  client: TelegramClient,
): Promise<{ group: string; checked: number; applied: number }[]> {
  const groups = await prisma.telegramGroup.findMany({
    where: { name: { in: [...RESULT_EMOJI_GROUP_NAMES] } },
  });

  const results: { group: string; checked: number; applied: number }[] = [];

  for (const group of groups) {
    const tips = await prisma.telegramTip.findMany({
      where: { groupId: group.id },
      select: { telegramMessageId: true },
      distinct: ["telegramMessageId"],
    });
    const ids = tips.map((t) => Number(t.telegramMessageId));

    let applied = 0;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const messages = await client.getMessages(bigInt(group.telegramChatId), { ids: batch });
      for (const message of messages) {
        if (!message) continue; // mensagem apagada — undefined no lugar dela
        applied += await applyEditedMessageResult(message.id, message.message, group);
      }
    }

    results.push({ group: group.name, checked: ids.length, applied });
  }

  return results;
}
