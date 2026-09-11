import { Queue, Worker } from "bullmq";
import { prisma, supabaseAdmin, PHOTO_BUCKET } from "../db.js";
import { extractTipDetails } from "../visionProvider.js";

const QUEUE_NAME = "extract-details";

type TipToFill = { id: string; needMarket: boolean; needGame: boolean; needOdd: boolean };

/**
 * "rows" with >1 tip: each maps 1:1 to one OCR selection, in bet-slip order
 * (parseTip's `unit_lines` pattern — genuinely independent stakes, each its
 * own odd). "rows" with exactly 1 tip, or "combo" (always 1 tip): the photo
 * may show a single selection OR several legs of one combined bet — handled
 * the same way (applyMultiLegResult), since there's no way to tell which
 * from the text alone.
 */
export type ExtractDetailsJob = { photoPath: string; kind: "rows" | "combo"; tips: TipToFill[] };

// Plain options object, not a constructed IORedis instance: bullmq bundles
// its own nested `ioredis` copy, and a `Redis` instance from the workspace's
// top-level `ioredis` doesn't structurally match bullmq's own type for it.
function connection() {
  const url = new URL(process.env.REDIS_URL!);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

export const extractDetailsQueue = new Queue<ExtractDetailsJob>(QUEUE_NAME, { connection: connection() });

/** Joins every leg the OCR found for a single tip with a real line break — the
 * frontend renders `selection.split("\n")` as a list, so this is the one
 * place that decides where lines break (never Gemini's own "E"/vírgula/hífen
 * phrasing, which isn't reliable — see buildPrompt in geminiVision.ts). */
async function applyMultiLegResult(
  tipId: string,
  tip: TipToFill,
  buffer: Buffer,
  photoPath: string,
  expectedCount: number | null,
) {
  const { selections, totalOdd } = await extractTipDetails(buffer, photoPath, expectedCount);
  if (selections.length === 0 && totalOdd === null) return;

  const market = selections
    .map((s) => s.market)
    .filter((m): m is string => !!m)
    .join("\n");
  const games = [...new Set(selections.map((s) => s.game).filter((g): g is string => !!g))];
  const odd = totalOdd ?? (selections.length === 1 ? selections[0]!.odd : null);

  await prisma.telegramTip.update({
    where: { id: tipId },
    data: {
      ...(tip.needMarket && market ? { selection: market } : {}),
      ...(tip.needGame && games.length === 1 ? { match: games[0] } : {}),
      ...(tip.needOdd && odd !== null ? { odd, oddSource: "ocr" } : {}),
    },
  });
}

async function processJob(data: ExtractDetailsJob) {
  const { data: file, error } = await supabaseAdmin.storage.from(PHOTO_BUCKET).download(data.photoPath);
  if (error || !file) {
    console.error("[extract-details] failed to download photo:", error);
    return;
  }
  const buffer = Buffer.from(await file.arrayBuffer());

  // Um único tip pra essa foto (padrão comum) — pode ser 1 seleção simples
  // ou uma combinada com várias pernas, sem saber de antemão qual; sempre
  // junta o que a OCR achar com quebra de linha real (ver applyMultiLegResult).
  if (data.kind === "combo" || data.tips.length === 1) {
    const tip = data.tips[0];
    if (!tip) return;
    await applyMultiLegResult(tip.id, tip, buffer, data.photoPath, data.kind === "combo" ? null : 1);
    return;
  }

  const { selections } = await extractTipDetails(buffer, data.photoPath, data.tips.length);
  if (selections.length === 0) return;

  for (let i = 0; i < data.tips.length; i++) {
    const tip = data.tips[i]!;
    // Mesma regra de degradação graciosa do OCR original: se a foto não
    // separou as seleções direito, aplica a primeira em todas — fica
    // marcado como "ocr" e disponível pra correção manual, nunca trava.
    const sel = selections[i] ?? selections[0]!;
    await prisma.telegramTip.update({
      where: { id: tip.id },
      data: {
        ...(tip.needMarket && sel.market ? { selection: sel.market } : {}),
        ...(tip.needGame && sel.game ? { match: sel.game } : {}),
        ...(tip.needOdd && sel.odd !== null ? { odd: sel.odd, oddSource: "ocr" } : {}),
      },
    });
  }
}

export function startExtractDetailsWorker(): Worker<ExtractDetailsJob> {
  return new Worker<ExtractDetailsJob>(
    QUEUE_NAME,
    async (job) => {
      await processJob(job.data);
    },
    { connection: connection() },
  );
}
