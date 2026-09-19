import type { TelegramClient } from "telegram";
import bigInt from "big-integer";
import { prisma } from "./db.js";
import { applyMyReactionTake } from "./reactionTake.js";
import { applyEditedMessageResult, RESULT_SIGNAL_GROUP_NAMES } from "./resultFromEmoji.js";

const BATCH_SIZE = 100;

/** Reaplica 👍/👎 e resultado por emoji das tips recentes, lendo o estado atual
 * direto do Telegram — cobre updates que o push não entregou (o GramJS não faz
 * catch-up) e devolve o que uma reimportação apagou. Nunca sobrescreve nada:
 * a reação só cria take que ainda não existe, e o resultado só vale se a tip
 * ainda estiver "pending" (ver applyEditedMessageResult). */
export async function syncRecentSignals(client: TelegramClient, sinceHours: number): Promise<{ takes: number; results: number }> {
  const since = new Date(Date.now() - sinceHours * 3600 * 1000);
  const groups = await prisma.telegramGroup.findMany({ where: { active: true } });
  let takes = 0;
  let results = 0;

  for (const group of groups) {
    const tips = await prisma.telegramTip.findMany({
      where: { groupId: group.id, receivedAt: { gte: since } },
      select: { telegramMessageId: true },
      distinct: ["telegramMessageId"],
    });
    const ids = tips.map((t) => Number(t.telegramMessageId));

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const messages = await client.getMessages(bigInt(group.telegramChatId), { ids: ids.slice(i, i + BATCH_SIZE) });
      for (const message of messages) {
        if (!message) continue;
        takes += await applyMyReactionTake(group.id, BigInt(message.id), message.reactions, true);
        if (RESULT_SIGNAL_GROUP_NAMES.has(group.name)) {
          results += await applyEditedMessageResult(message.id, message.message, group);
        }
      }
    }
  }
  return { takes, results };
}
