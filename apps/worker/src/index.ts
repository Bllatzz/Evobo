import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import input from "input";
import { prisma, requireEnv } from "./db.js";
import { processMessage } from "./processMessage.js";
import { startExtractDetailsWorker } from "./queues/extractDetailsWorker.js";
import { purgeOldTips } from "./purgeOldTips.js";
import { backfillSince } from "./backfillRange.js";
import { runDailyGrading } from "./betAnalytix/runDailyGrading.js";

export { retryMissingOcr } from "./retryOcr.js";
export { runDailyGrading } from "./betAnalytix/runDailyGrading.js";

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
// 03:00 América/São Paulo == 06:00 UTC — fuso fixo (UTC-3, sem horário de
// verão desde 2019), mesma convenção que o resto do módulo já usa.
const GRADING_HOUR_UTC = 6;

/** setTimeout que se reagenda pro próximo 3h de SP em vez de um setInterval
 * fixo de 24h — não dessincroniza do horário de parede se o processo
 * reiniciar num horário qualquer. */
function scheduleDailyGrading(): void {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), GRADING_HOUR_UTC, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);

  setTimeout(() => {
    runDailyGrading()
      .then((r) => console.log("[bet-analytix] grading diário:", r))
      .catch((err) => console.error("[bet-analytix] falha no grading diário:", err))
      .finally(scheduleDailyGrading);
  }, next.getTime() - now.getTime());
}

// Set once startTelegramWorker's client connects — reused by
// runBackfillSince so an on-demand backfill never opens a second MTProto
// connection with the same TELEGRAM_SESSION (Telegram kicks the older one).
let liveClient: TelegramClient | null = null;

/** On-demand backfill triggered from the API (see the admin route) instead
 * of the standalone script — reuses the already-connected live session.
 * Throws if the worker hasn't finished connecting yet. */
export async function runBackfillSince(sinceUnix: number, untilUnix?: number) {
  if (!liveClient) throw new Error("telegram worker not connected yet");
  return backfillSince(liveClient, sinceUnix, untilUnix);
}

/** Telegram MTProto listener + OCR queue consumer. Exported (rather than
 * run at import time) so apps/api can start it in-process — see run.ts for
 * the standalone-process entrypoint apps/worker's own dev/start scripts use. */
export async function startTelegramWorker() {
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
  console.log("[worker] conectado. Session string (salve em TELEGRAM_SESSION no .env):");
  console.log(client.session.save());
  liveClient = client;

  startExtractDetailsWorker();

  purgeOldTips().catch((err) => console.error("[purge] falha:", err));
  setInterval(() => purgeOldTips().catch((err) => console.error("[purge] falha:", err)), PURGE_INTERVAL_MS);
  scheduleDailyGrading();

  const groups = await prisma.telegramGroup.findMany({ where: { active: true } });
  const groupByChatId = new Map(groups.map((g) => [g.telegramChatId, g]));
  console.log(`[worker] escutando ${groups.length} grupo(s): ${groups.map((g) => g.name).join(", ") || "(nenhum cadastrado)"}`);

  // Filtra manualmente por chatId em vez de passar `chats` pro NewMessage —
  // evita depender da resolução de entity do GramJS pra ids numéricos brutos.
  client.addEventHandler(async (event: NewMessageEvent) => {
    const chatId = event.chatId?.toString();
    const group = chatId ? groupByChatId.get(chatId) : undefined;
    if (!group) return;

    try {
      await processMessage(event.message, group);
    } catch (err) {
      console.error("[worker] falha ao processar mensagem:", err);
    }
  }, new NewMessage({}));
}
