/**
 * Busca mensagens de cada grupo cadastrado e processa como se tivessem
 * acabado de chegar — só pra testar o parser/OCR sem esperar uma tip nova de
 * verdade. Idempotente: mensagens já processadas são puladas (ver
 * processMessage.ts), então rodar de novo não duplica tips.
 *
 * Uso: npm run backfill -- --limit=10
 *      npm run backfill -- --today   (tudo desde 00:00 de hoje, América/São Paulo, com paginação)
 */
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import bigInt from "big-integer";
import input from "input";
import { prisma, requireEnv } from "../src/db.js";
import { processMessage } from "../src/processMessage.js";

const PAGE_SIZE = 100;

function limitFromArgs(): number {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  return arg ? Number(arg.split("=")[1]) : 10;
}

/** Meia-noite de hoje em América/São Paulo, como timestamp unix (segundos). */
function startOfTodaySaoPauloUnix(): number {
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const [y, m, d] = todayIso.split("-").map(Number);
  // São Paulo é UTC-3 o ano todo (sem horário de verão desde 2019) — meia-noite
  // local = 03:00 UTC do mesmo dia.
  return Date.UTC(y!, m! - 1, d!, 3, 0, 0) / 1000;
}

/** Busca todas as mensagens de `chatId` com `date >= sinceUnix`, paginando
 * pra trás enquanto ainda houver mensagens dentro da janela. */
async function fetchMessagesSince(client: TelegramClient, chatId: string, sinceUnix: number) {
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

async function main() {
  const today = process.argv.includes("--today");
  const limit = limitFromArgs();
  const apiId = Number(requireEnv("TELEGRAM_API_ID"));
  const apiHash = requireEnv("TELEGRAM_API_HASH");
  const client = new TelegramClient(new StringSession(process.env.TELEGRAM_SESSION ?? ""), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => input.text("Número de telefone: "),
    password: async () => input.text("Senha (2FA, se houver): "),
    phoneCode: async () => input.text("Código recebido no Telegram: "),
    onError: (err) => console.error(err),
  });

  const groups = await prisma.telegramGroup.findMany({ where: { active: true } });
  if (groups.length === 0) {
    console.log("Nenhum grupo cadastrado — cadastre via POST /telegram-tips/groups antes de rodar o backfill.");
    return;
  }

  for (const group of groups) {
    const messages = today
      ? await fetchMessagesSince(client, group.telegramChatId, startOfTodaySaoPauloUnix())
      : await client.getMessages(bigInt(group.telegramChatId), { limit });
    console.log(
      `\n[backfill] ${group.name} (${group.telegramChatId}) — ${today ? "mensagens de hoje" : `últimas ${limit} mensagens`} (${messages.length})`,
    );

    // getMessages vem mais nova → mais antiga; processa em ordem cronológica.
    for (const message of [...messages].reverse()) {
      if (!message.message && !message.photo) continue; // mensagem de serviço (entrou/saiu etc.)
      const result = await processMessage(message, group);
      console.log(`  msg ${message.id} (${new Date(message.date * 1000).toLocaleString("pt-BR")}) → ${result}`);
    }
  }

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
