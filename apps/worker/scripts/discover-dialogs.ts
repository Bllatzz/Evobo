/**
 * Lista os chats/grupos/canais visíveis pra conta logada, com o id que o
 * MTProto usa — que não é o mesmo id que aparece na URL do web.telegram.org.
 * Rode `npm run discover` e copie o id do grupo que quer rastrear pra
 * cadastrá-lo via `POST /telegram-tips/groups` (name + telegramChatId).
 *
 * Também faz o login interativo na primeira vez (mesmo fluxo que
 * `src/index.ts` usa) e imprime a session string pra salvar em
 * TELEGRAM_SESSION, já que os dois processos precisam da mesma sessão.
 */
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";
import { requireEnv } from "../src/db.js";

async function main() {
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

  console.log("\nSession string (salve em TELEGRAM_SESSION no .env se ainda não tiver):");
  console.log(client.session.save());

  const dialogs = await client.getDialogs({});
  console.log("\nGrupos/canais:");
  for (const dialog of dialogs) {
    if (!dialog.isGroup && !dialog.isChannel) continue;
    console.log(`${(dialog.id?.toString() ?? "?").padEnd(20)}  ${dialog.title ?? dialog.name ?? "(sem nome)"}`);
  }

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
