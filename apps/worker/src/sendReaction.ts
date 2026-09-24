import type { TelegramClient } from "telegram";
import { Api } from "telegram/tl/index.js";
import bigInt from "big-integer";
import { prisma } from "./db.js";

/** Reações que a própria API colocou (extensão de apostas), por
 * `${groupId}:${msgId}` → emoji e até quando vale. O listener
 * (reactionTake.ts) ignora esse eco: a reação é da mensagem inteira, mas a
 * API grava peguei/não peguei perna por perna logo depois de reagir — o eco
 * marcaria TODAS as tips com o mesmo status (ex.: a simples suspensa virando
 * "peguei" por causa do 👍). O push do Telegram às vezes chega minutos
 * depois, daí a janela longa. */
const OWN_REACTION_TTL_MS = 15 * 60 * 1000;
const ownReactions = new Map<string, { emoji: string; until: number }>();

export function isOwnReactionEcho(groupId: string, telegramMessageId: bigint, emoji: string): boolean {
  const key = `${groupId}:${telegramMessageId}`;
  const own = ownReactions.get(key);
  if (!own) return false;
  if (Date.now() > own.until) {
    ownReactions.delete(key);
    return false;
  }
  return own.emoji === emoji;
}

/** Reage na mensagem da tip com a PRÓPRIA conta do worker — usado pela
 * extensão de apostas (via API, ver apps/api's betting-queue): 👍 quando
 * apostou pelo menos uma perna, 👎 quando não apostou nada. Registra antes
 * de reagir que esse eco deve ser ignorado (ver ownReactions). */
export async function sendMyReaction(
  client: TelegramClient,
  groupId: string,
  telegramMessageId: bigint,
  emoji: "👍" | "👎",
): Promise<void> {
  const group = await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } });
  const now = Date.now();
  for (const [k, v] of ownReactions) if (now > v.until) ownReactions.delete(k);
  ownReactions.set(`${groupId}:${telegramMessageId}`, { emoji, until: now + OWN_REACTION_TTL_MS });
  await client.invoke(
    new Api.messages.SendReaction({
      peer: bigInt(group.telegramChatId),
      msgId: Number(telegramMessageId),
      reaction: [new Api.ReactionEmoji({ emoticon: emoji })],
    }),
  );
}
