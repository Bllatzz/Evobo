/**
 * Busca as últimas N mensagens de cada grupo cadastrado e processa como se
 * tivessem acabado de chegar — só pra testar o parser/OCR sem esperar uma
 * tip nova de verdade. Idempotente: mensagens já processadas são puladas
 * (ver processMessage.ts), então rodar de novo não duplica tips.
 *
 * Uso: npm run backfill -- --limit=10
 */
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import bigInt from "big-integer";
import input from "input";
import { prisma, requireEnv } from "../src/db.js";
import { processMessage } from "../src/processMessage.js";

function limitFromArgs(): number {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  return arg ? Number(arg.split("=")[1]) : 10;
}

async function main() {
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
    console.log(`\n[backfill] ${group.name} (${group.telegramChatId}) — últimas ${limit} mensagens`);
    const messages = await client.getMessages(bigInt(group.telegramChatId), { limit });

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
