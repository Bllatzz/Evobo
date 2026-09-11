import { Api } from "telegram/tl/index.js";
import type { TelegramGroup } from "@prisma/client";
import { prisma, supabaseAdmin, PHOTO_BUCKET } from "./db.js";
import { parseTip, type TextEntity } from "./parseTip.js";
import { extractDetailsQueue } from "./queues/extractDetailsWorker.js";

function messageEntities(message: Api.Message): TextEntity[] {
  return (message.entities ?? [])
    .filter((e): e is Api.MessageEntityTextUrl => e.className === "MessageEntityTextUrl")
    .map((e) => ({ url: e.url }));
}

async function downloadPhoto(message: Api.Message, group: TelegramGroup): Promise<string | null> {
  if (!message.photo) return null;
  const buffer = await message.downloadMedia();
  if (!buffer || !Buffer.isBuffer(buffer)) return null;

  const photoPath = `${group.id}/${message.id}.jpg`;
  const { error } = await supabaseAdmin.storage
    .from(PHOTO_BUCKET)
    .upload(photoPath, buffer, { contentType: "image/jpeg", upsert: true });
  if (error) {
    console.error("[worker] falha ao subir foto:", error);
    return null;
  }
  return photoPath;
}

/** Usado tanto pelo listener ao vivo (index.ts) quanto pelo backfill de teste
 * (scripts/backfill.ts) — parseia a mensagem, cria o(s) TelegramTip e
 * enfileira a OCR do que faltar. Pula mensagens já processadas (mesmo
 * group + telegramMessageId) pra rodar o backfill mais de uma vez sem duplicar. */
export async function processMessage(message: Api.Message, group: TelegramGroup): Promise<"created" | "skipped_duplicate" | "skipped_no_signal"> {
  const already = await prisma.telegramTip.findFirst({
    where: { groupId: group.id, telegramMessageId: BigInt(message.id) },
    select: { id: true },
  });
  if (already) return "skipped_duplicate";

  const parsed = parseTip(message.message, messageEntities(message));
  if (!parsed) return "skipped_no_signal";

  const photoPath = await downloadPhoto(message, group);

  const createdTips = await Promise.all(
    parsed.selections.map((sel) =>
      prisma.telegramTip.create({
        data: {
          groupId: group.id,
          telegramMessageId: BigInt(message.id),
          match: parsed.match ?? null,
          selection: sel.text ?? "",
          unit: sel.unit,
          odd: sel.odd ?? null,
          oddSource: sel.odd !== undefined ? "text" : null,
          bookmaker: sel.bookmaker !== undefined ? sel.bookmaker : parsed.bookmaker,
          betUrl: sel.betUrl !== undefined ? sel.betUrl : parsed.betUrl,
          photoPath,
          parsePattern: parsed.pattern,
          rawMessage: message.message || null,
        },
      }),
    ),
  );

  if (!photoPath) return "created"; // nada pra OCR sem foto — campos ficam pra edição manual

  const needsGame = parsed.match === undefined;
  const tipsToFill = createdTips.map((tip, i) => ({
    id: tip.id,
    needMarket: parsed.selections[i]!.text === null,
    needGame: needsGame,
    needOdd: parsed.selections[i]!.odd === undefined,
  }));

  // Formatos mais completos (Padovan) já trazem mercado/jogo/odd no texto —
  // nesse caso não há nada pra OCR buscar, economiza uma chamada à toa.
  if (tipsToFill.every((t) => !t.needMarket && !t.needGame && !t.needOdd)) return "created";

  // Gemini ocasionalmente devolve 503 (alta demanda) — transitório, então
  // vale tentar de novo antes de deixar pra edição manual.
  const retryOpts = { attempts: 3, backoff: { type: "exponential" as const, delay: 5_000 } };

  if (parsed.pattern === "combo" || tipsToFill.length === 1) {
    const tip = tipsToFill[0]!;
    await extractDetailsQueue.add(
      "extract",
      { photoPath, kind: parsed.pattern === "combo" ? "combo" : "rows", tips: [tip] },
      retryOpts,
    );
    return "created";
  }

  await extractDetailsQueue.add("extract", { photoPath, kind: "rows", tips: tipsToFill }, retryOpts);
  return "created";
}
