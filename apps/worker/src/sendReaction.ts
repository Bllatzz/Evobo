import type { TelegramClient } from "telegram";
import { Api } from "telegram/tl/index.js";
import bigInt from "big-integer";
import { prisma } from "./db.js";

/** Reage na mensagem da tip com a PRÓPRIA conta do worker — usado pela
 * extensão de apostas (via API, ver apps/api's betting-queue): 👍 quando
 * apostou, 👎 quando pulou. O listener de reações (reactionTake.ts) vê essa
 * reação voltar como UpdateMessageReactions e marca o take igual a uma
 * reação manual — por isso a API grava o take com a odd real ANTES de
 * reagir: o listener nunca sobrescreve odd/unidade de um take existente. */
export async function sendMyReaction(
  client: TelegramClient,
  groupId: string,
  telegramMessageId: bigint,
  emoji: "👍" | "👎",
): Promise<void> {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  await client.invoke(
    new Api.messages.SendReaction({
      peer: bigInt(group.telegramChatId),
      msgId: Number(telegramMessageId),
      reaction: [new Api.ReactionEmoji({ emoticon: emoji })],
    }),
  );
}
