import type { TelegramClient } from "telegram";
import bigInt from "big-integer";
import { prisma } from "./db.js";
import { processMessage } from "./processMessage.js";

const PAGE_SIZE = 100;

/** Busca todas as mensagens de `chatId` com `date >= sinceUnix`, paginando
 * pra trás enquanto ainda houver mensagens dentro da janela. */
export async function fetchMessagesSince(client: TelegramClient, chatId: string, sinceUnix: number) {
  const all = [];
  let offsetId = 0;
  while (true) {
    const page = await client.getMessages(bigInt(chatId), { limit: PAGE_SIZE, offsetId });
    if (page.length === 0) break;
    for (const msg of page) {
      if (msg.date >= sinceUnix) all.push(msg);
    }
    const oldest = page[page.length - 1]!;
    if (oldest.date < sinceUnix || page.length < PAGE_SIZE) break; // passou da janela ou acabaram as mensagens
    offsetId = oldest.id;
  }
  return all;
}

/** Reprocessa todo grupo ativo desde `sinceUnix` usando um client já
 * conectado (a sessão MTProto viva do worker — nunca abrir uma segunda
 * conexão com a mesma TELEGRAM_SESSION, o Telegram derruba a mais antiga).
 * Idempotente via processMessage's dedupe por (groupId, telegramMessageId). */
export async function backfillSince(client: TelegramClient, sinceUnix: number) {
  const groups = await prisma.telegramGroup.findMany({ where: { active: true } });
  const results: { group: string; messages: number; created: number; skipped: number }[] = [];

  for (const group of groups) {
    const messages = await fetchMessagesSince(client, group.telegramChatId, sinceUnix);
    let created = 0;
    let skipped = 0;
    // getMessages vem mais nova → mais antiga; processa em ordem cronológica.
    for (const message of [...messages].reverse()) {
      if (!message.message && !message.photo) continue; // mensagem de serviço (entrou/saiu etc.)
      const status = await processMessage(message, group);
      if (status === "created") created++;
      else skipped++;
    }
    results.push({ group: group.name, messages: messages.length, created, skipped });
  }

  return results;
}
