import { TelegramClient, utils } from "telegram";
import { Api } from "telegram/tl/index.js";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, Raw, type NewMessageEvent } from "telegram/events/index.js";
import { EditedMessage, type EditedMessageEvent } from "telegram/events/EditedMessage.js";
import input from "input";
import { prisma, requireEnv } from "./db.js";
import { processMessage } from "./processMessage.js";
import { startExtractDetailsWorker } from "./queues/extractDetailsWorker.js";
import { purgeOldTips } from "./purgeOldTips.js";
import { backfillSince, fillGapsSince } from "./backfillRange.js";
import { runDailyGrading } from "./betAnalytix/runDailyGrading.js";
import { applyEditedMessageResult } from "./resultFromEmoji.js";
import { backfillResultFromEmoji } from "./backfillResultFromEmoji.js";
import { applyMyReactionTake } from "./reactionTake.js";
import { backfillReactionTake } from "./backfillReactionTake.js";
import { syncRecentSignals } from "./syncRecentSignals.js";

export { retryMissingOcr } from "./retryOcr.js";
export { runDailyGrading } from "./betAnalytix/runDailyGrading.js";
export {
  matchBookmakerBet,
  GAME_SIMILARITY_THRESHOLD,
  type CandidateTip,
  type BookmakerBetOutcome,
  type BookmakerBetMatch,
} from "./bookmakerImport/matchBookmakerBets.js";
export { ODD_TOLERANCE, textSimilarity } from "./betAnalytix/matchTips.js";

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

/** Igual a runBackfillSince, mas nunca apaga tips existentes na janela —
 * pra preencher uma mensagem que ficou de fora (ex.: chegou bem na hora de
 * um deploy) sem arriscar perder peguei/não peguei ou resultado de outra
 * tip que já exista nessa mesma janela. Ver fillGapsSince. */
export async function runFillGapsSince(sinceUnix: number, untilUnix?: number) {
  if (!liveClient) throw new Error("telegram worker not connected yet");
  return fillGapsSince(liveClient, sinceUnix, untilUnix);
}

/** On-demand, mesmo padrão do runBackfillSince acima — aplica ✅✅✅/❌❌❌
 * retroativamente nas mensagens já importadas (ver backfillResultFromEmoji.ts),
 * pra pegar edições que o tipster já tinha feito antes desse listener existir. */
export async function runBackfillResultFromEmoji() {
  if (!liveClient) throw new Error("telegram worker not connected yet");
  return backfillResultFromEmoji(liveClient);
}

/** On-demand, mesmo padrão acima — aplica retroativamente os 👍/👎 que a
 * conta do worker já tinha dado antes do listener de reação existir (ver
 * backfillReactionTake.ts). */
export async function runBackfillReactionTake() {
  if (!liveClient) throw new Error("telegram worker not connected yet");
  return backfillReactionTake(liveClient);
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
  console.log("[worker] conectado.");
  liveClient = client;

  // Recupera tips perdidas num incidente real de "listener vivo mas surdo"
  // (mesmo bug do robotip, ver telegram.js — client.connected fica true
  // enquanto os updates param de chegar; sem isso a mensagem nunca é
  // reprocessada, mesmo depois do watchdog abaixo reconectar). Roda 1x no
  // boot cobrindo uma janela generosa (3h) — processMessage já deduplica
  // por (groupId, telegramMessageId), então rodar de novo sobre mensagem
  // já importada é no-op.
  // fillGapsSince, NÃO backfillSince: este último apaga e recria toda tip da
  // janela (perde OCR, 👍/👎 e resultado), e rodava a cada deploy.
  // Depois de preencher as tips que faltam, devolve 👍/👎 e resultado por
  // emoji das últimas 12h (cobre o que os backfills apagando tips levaram hoje).
  fillGapsSince(client, Math.floor(Date.now() / 1000) - 3 * 3600)
    .then(() => syncRecentSignals(client, 12))
    .then((r) => console.log(`[worker] sync de boot: ${r.takes} peguei/não peguei e ${r.results} resultado(s) restaurados.`))
    .catch((err) => console.error("[worker] falha no backfill de boot:", err));

  startExtractDetailsWorker();

  purgeOldTips().catch((err) => console.error("[purge] falha:", err));
  setInterval(() => purgeOldTips().catch((err) => console.error("[purge] falha:", err)), PURGE_INTERVAL_MS);
  scheduleDailyGrading();

  const groups = await prisma.telegramGroup.findMany({ where: { active: true } });
  const groupByChatId = new Map(groups.map((g) => [g.telegramChatId, g]));
  console.log(`[worker] escutando ${groups.length} grupo(s): ${groups.map((g) => g.name).join(", ") || "(nenhum cadastrado)"}`);

  // Sinal de vida real do listener — ver o watchdog logo abaixo. Mesmo
  // problema encontrado e corrigido no listener do robotip
  // (packages/robotip-legacy/src/services/telegram.js): o GramJS pode ficar
  // com o socket MTProto "conectado" enquanto a assinatura de updates do
  // servidor trava silenciosamente, e esse client usa autoReconnect padrão
  // (true) — o que cobre queda de socket, mas não esse caso "vivo mas
  // surdo". Atualizado em QUALQUER update recebido, mesmo um que a gente
  // ignora (grupo não cadastrado, etc.).
  let lastUpdateAt = Date.now();

  // Filtra manualmente por chatId em vez de passar `chats` pro NewMessage —
  // evita depender da resolução de entity do GramJS pra ids numéricos brutos.
  client.addEventHandler(async (event: NewMessageEvent) => {
    lastUpdateAt = Date.now();
    const chatId = event.chatId?.toString();
    const group = chatId ? groupByChatId.get(chatId) : undefined;
    if (!group) return;

    console.log(`[worker] msg ${event.message.id} (${group.name}) via push, atraso ${Math.round(Date.now() / 1000 - event.message.date)}s`);
    try {
      await processMessage(event.message, group);
    } catch (err) {
      console.error("[worker] falha ao processar mensagem:", err);
    }
  }, new NewMessage({}));

  // Só usado hoje pelo Super Odds, que marca o resultado editando a própria
  // mensagem em vez de mandar no bet-analytix (3x ✅/❌) — ver resultFromEmoji.ts.
  client.addEventHandler(async (event: EditedMessageEvent) => {
    lastUpdateAt = Date.now();
    const chatId = event.chatId?.toString();
    const group = chatId ? groupByChatId.get(chatId) : undefined;
    if (!group) return;

    try {
      await applyEditedMessageResult(event.message.id, event.message.message, group);
    } catch (err) {
      console.error("[worker] falha ao processar mensagem editada:", err);
    }
  }, new EditedMessage({}));

  // 👍/👎 na própria conta marca peguei/não peguei — ver reactionTake.ts.
  // Reação não vem como NewMessage/EditedMessage, só como update raw.
  client.addEventHandler(async (update: Api.UpdateMessageReactions) => {
    lastUpdateAt = Date.now();
    const chatId = utils.getPeerId(update.peer);
    const group = groupByChatId.get(chatId);
    if (!group) return;

    try {
      await applyMyReactionTake(group.id, BigInt(update.msgId), update.reactions);
    } catch (err) {
      console.error("[worker] falha ao processar reação:", err);
    }
  }, new Raw({ types: [Api.UpdateMessageReactions] }));

  // O GramJS não faz catch-up de updates (catchUp() é TODO) e o Telegram pode
  // atrasar o push de canais pra sessão de usuário por minutos sem cair a
  // conexão — o watchdog abaixo não vê isso. Então buscamos ativamente as
  // últimas mensagens de cada grupo; processMessage dedupe (e ignora as que o
  // push está processando agora), então é seguro rodar junto com o listener.
  const POLL_INTERVAL_MS = 15_000;
  const POLL_WINDOW_S = 10 * 60;
  let polling = false;
  setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const results = await fillGapsSince(client, Math.floor(Date.now() / 1000) - POLL_WINDOW_S);
      const created = results.reduce((sum, r) => sum + r.created, 0);
      if (created > 0) console.log(`[worker] poll recuperou ${created} tip(s) que o push não entregou.`);
      const sync = await syncRecentSignals(client, 2);
      if (sync.takes > 0 || sync.results > 0) console.log(`[worker] sync recuperou ${sync.takes} reação(ões) e ${sync.results} resultado(s) que o push não entregou.`);
    } catch (err) {
      console.error("[worker] falha no poll de mensagens:", err);
    } finally {
      polling = false;
    }
  }, POLL_INTERVAL_MS);

  // Watchdog: se ficar WORKER_STALE_THRESHOLD_MS sem nenhum update (mesmo
  // client.connected continuando true), força disconnect+connect no mesmo
  // client — reaproveita sessão/entities já carregadas, sem precisar
  // recriar o TelegramClient nem relogar. autoReconnect (padrão true nesse
  // client) cobre queda de socket; isto cobre o caso "vivo mas surdo" que
  // ele não pega.
  const WORKER_STALE_THRESHOLD_MS = 10 * 60_000;
  const WORKER_WATCHDOG_INTERVAL_MS = 60_000;
  setInterval(async () => {
    const silentForMs = Date.now() - lastUpdateAt;
    if (silentForMs <= WORKER_STALE_THRESHOLD_MS) return;

    // sinceUnix a partir de quando ficou mudo (com folga de 5min pra trás,
    // margem contra imprecisão do próprio lastUpdateAt) — reconectar sozinho
    // não reprocessa as mensagens perdidas durante o silêncio, só volta a
    // receber as novas a partir de agora; sem isso a tip fica perdida pra
    // sempre mesmo com o listener saudável de novo.
    const goneQuietAt = lastUpdateAt;
    console.error(`[worker] listener mudo há ${Math.round(silentForMs / 60_000)}min — forçando reconexão.`);
    try {
      await client.disconnect();
      await client.connect();
      lastUpdateAt = Date.now();
      console.log("[worker] reconectado após ficar mudo.");

      const sinceUnix = Math.floor(goneQuietAt / 1000) - 5 * 60;
      const results = await fillGapsSince(client, sinceUnix);
      const created = results.reduce((sum, r) => sum + r.created, 0);
      console.log(`[worker] backfill pós-reconexão: ${created} tip(s) recuperada(s).`);
    } catch (err) {
      console.error("[worker] falha ao forçar reconexão:", err);
    }
  }, WORKER_WATCHDOG_INTERVAL_MS);
}
