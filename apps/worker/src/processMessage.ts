import { Api } from "telegram/tl/index.js";
import type { TelegramGroup } from "@prisma/client";
import { prisma, supabaseAdmin, PHOTO_BUCKET } from "./db.js";
import { parseTip, parseStakeTopUp, type TextEntity } from "./parseTip.js";
import { extractDetailsQueue } from "./queues/extractDetailsWorker.js";

function messageEntities(message: Api.Message): TextEntity[] {
  return (message.entities ?? [])
    .filter((e): e is Api.MessageEntityTextUrl => e.className === "MessageEntityTextUrl")
    .map((e) => ({ url: e.url }));
}

const UPLOAD_ATTEMPTS = 3;
const UPLOAD_RETRY_DELAY_MS = 1_000;

/** Falha do Storage costuma ser passageira — tenta algumas vezes antes de
 * desistir (1s, depois 2s de espera). Se nenhuma funcionar, o chamador cria a
 * tip sem foto: ela nunca some por causa da imagem, e o link/texto da aposta
 * continuam salvos nela. */
async function uploadPhoto(photoPath: string, buffer: Buffer): Promise<boolean> {
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    const { error } = await supabaseAdmin.storage
      .from(PHOTO_BUCKET)
      .upload(photoPath, buffer, { contentType: "image/jpeg", upsert: true });
    if (!error) return true;
    console.error(`[worker] falha ao subir foto (tentativa ${attempt}/${UPLOAD_ATTEMPTS}):`, error);
    if (attempt < UPLOAD_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, UPLOAD_RETRY_DELAY_MS * attempt));
  }
  return false;
}

async function downloadPhoto(message: Api.Message, group: TelegramGroup): Promise<string | null> {
  if (!message.photo) return null;
  const buffer = await message.downloadMedia();
  if (!buffer || !Buffer.isBuffer(buffer)) return null;

  const photoPath = `${group.id}/${message.id}.jpg`;
  return (await uploadPhoto(photoPath, buffer)) ? photoPath : null;
}

/**
 * "+0,50u aq na odd 3.96, fechando 1u" replying to an already-known tip —
 * adds stake to it as a SIBLING TelegramTip (own id, so a later 👍/👎 on
 * this reply marks its own TelegramTipTake independently — the user may
 * have taken the top-up without taking the original, or vice versa), never
 * by mutating the original (which would need a blended odd to stay
 * accurate). Bails (returns null) whenever the reply target isn't exactly
 * one already-tracked tip — ambiguous (e.g. replying to a message that
 * became several legs) or untracked, never guess which one it's topping up.
 */
async function createStakeTopUpTip(message: Api.Message, group: TelegramGroup): Promise<boolean> {
  const replyToMsgId = message.replyToMsgId;
  if (replyToMsgId === undefined) return false;

  const topUp = parseStakeTopUp(message.message);
  if (!topUp) return false;

  const parents = await prisma.telegramTip.findMany({
    where: { groupId: group.id, telegramMessageId: BigInt(replyToMsgId) },
  });
  if (parents.length !== 1) return false;

  const parent = parents[0]!;
  const odd = topUp.odd ?? parent.odd;
  await prisma.telegramTip.create({
    data: {
      groupId: group.id,
      telegramMessageId: BigInt(message.id),
      receivedAt: new Date(message.date * 1000),
      match: parent.match,
      selection: parent.selection,
      marketType: parent.marketType,
      unit: topUp.addedUnit,
      odd,
      oddSource: topUp.odd !== null ? "text" : parent.oddSource,
      originalOdd: odd,
      bookmaker: parent.bookmaker,
      betUrl: parent.betUrl,
      bookmakerOptions: parent.bookmakerOptions ?? undefined,
      limit: parent.limit,
      photoPath: parent.photoPath,
      parsePattern: "stake_topup",
      rawMessage: message.message || null,
    },
  });
  return true;
}

/** Usado tanto pelo listener ao vivo (index.ts) quanto pelo backfill de teste
 * (scripts/backfill.ts) — parseia a mensagem, cria o(s) TelegramTip e
 * enfileira a OCR do que faltar. Pula mensagens já processadas (mesmo
 * group + telegramMessageId) pra rodar o backfill mais de uma vez sem duplicar. */
const inFlight = new Set<string>();

export async function processMessage(message: Api.Message, group: TelegramGroup): Promise<"created" | "skipped_duplicate" | "skipped_no_signal"> {
  // Listener ao vivo e poll podem pegar a mesma mensagem ao mesmo tempo; o
  // dedupe do banco só vale depois do create (que vem após o download da foto).
  const key = `${group.id}:${message.id}`;
  if (inFlight.has(key)) return "skipped_duplicate";
  inFlight.add(key);
  try {
    return await processMessageOnce(message, group);
  } finally {
    inFlight.delete(key);
  }
}

async function processMessageOnce(message: Api.Message, group: TelegramGroup): Promise<"created" | "skipped_duplicate" | "skipped_no_signal"> {
  const already = await prisma.telegramTip.findFirst({
    where: { groupId: group.id, telegramMessageId: BigInt(message.id) },
    select: { id: true },
  });
  if (already) return "skipped_duplicate";

  if (await createStakeTopUpTip(message, group)) return "created";

  const parsed = parseTip(message.message, messageEntities(message));
  if (!parsed) return "skipped_no_signal";

  const photoPath = await downloadPhoto(message, group);

  // Numa transação: uma mensagem com várias seleções entra inteira ou não
  // entra. Antes (Promise.all) uma falha no meio deixava só parte das tips, e
  // o dedupe acima tratava a mensagem como já processada pra sempre.
  const createdTips = await prisma.$transaction(
    parsed.selections.map((sel) =>
      prisma.telegramTip.create({
        data: {
          groupId: group.id,
          telegramMessageId: BigInt(message.id),
          // Data real da mensagem no Telegram, não o momento em que este
          // processo a importou — sem isso, um rebuild/backfill faz toda tip
          // reimportada "chegar" na hora do rebuild em vez da hora real,
          // quebrando filtros por data (relatório, "hoje", janela do rebuild).
          receivedAt: new Date(message.date * 1000),
          match: parsed.match ?? null,
          selection: sel.text ?? "",
          unit: sel.unit,
          odd: sel.odd ?? null,
          oddSource: sel.odd !== undefined ? "text" : null,
          originalOdd: sel.odd ?? null,
          bookmaker: sel.bookmaker !== undefined ? sel.bookmaker : parsed.bookmaker,
          betUrl: sel.betUrl !== undefined ? sel.betUrl : parsed.betUrl,
          bookmakerOptions: sel.bookmakerOptions ?? undefined,
          limit: parsed.fields.limit ?? null,
          photoPath,
          parsePattern: parsed.pattern,
          rawMessage: message.message || null,
        },
      }),
    ),
  );

  if (!photoPath) return "created"; // nada pra OCR sem foto — campos ficam pra edição manual

  const needsGame = parsed.match === undefined;
  // Categoria de mercado não tem contrapartida no parser de texto (ver
  // parseTip.ts) — só a OCR classifica, então toda tip nova começa
  // precisando dela; nunca entra no "every" abaixo pra não disparar uma
  // chamada de OCR só por causa disso quando mais nada falta (ver comentário
  // logo ali).
  const tipsToFill = createdTips.map((tip, i) => ({
    id: tip.id,
    needMarket: parsed.selections[i]!.text === null,
    needGame: needsGame,
    needOdd: parsed.selections[i]!.odd === undefined,
    needMarketType: true,
  }));

  // Formatos mais completos (Padovan) já trazem mercado/jogo/odd no texto —
  // nesse caso não há nada pra OCR buscar, economiza uma chamada à toa.
  if (tipsToFill.every((t) => !t.needMarket && !t.needGame && !t.needOdd)) return "created";

  // Gemini ocasionalmente devolve 503 (alta demanda) — transitório, então
  // vale tentar de novo antes de deixar pra edição manual.
  const retryOpts = { attempts: 3, backoff: { type: "exponential" as const, delay: 5_000 } };

  if (parsed.pattern === "combo" || parsed.pattern === "unit_each_plus_combo" || tipsToFill.length === 1) {
    const tip = tipsToFill[0]!;
    const legs =
      parsed.legsUnit !== undefined
        ? {
            unit: parsed.legsUnit,
            groupId: group.id,
            telegramMessageId: String(message.id),
            receivedAt: new Date(message.date * 1000).toISOString(),
            match: parsed.match ?? null,
            bookmaker: parsed.bookmaker,
            betUrl: parsed.betUrl,
            limit: parsed.fields.limit ?? null,
            rawMessage: message.message || null,
          }
        : undefined;
    await extractDetailsQueue.add(
      "extract",
      { photoPath, kind: parsed.pattern === "combo" || parsed.pattern === "unit_each_plus_combo" ? "combo" : "rows", tips: [tip], legs },
      retryOpts,
    );
    return "created";
  }

  await extractDetailsQueue.add("extract", { photoPath, kind: "rows", tips: tipsToFill }, retryOpts);
  return "created";
}
