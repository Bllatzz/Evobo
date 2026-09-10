import { Queue, Worker } from "bullmq";
import { prisma, supabaseAdmin, PHOTO_BUCKET } from "../db.js";
import { extractTipDetails } from "../geminiVision.js";

const QUEUE_NAME = "extract-details";

type TipToFill = { id: string; needMarket: boolean; needGame: boolean; needOdd: boolean };

/**
 * "rows": each tip in `tips` maps 1:1 to one OCR selection, in bet-slip
 * order (parseTip's `unit_lines`/single-selection patterns).
 * "combo": `tips` has exactly 1 entry — the photo shows several legs of one
 * combined bet, joined into that tip's `selection`/`match`/`odd`.
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

async function processJob(data: ExtractDetailsJob) {
  const { data: file, error } = await supabaseAdmin.storage.from(PHOTO_BUCKET).download(data.photoPath);
  if (error || !file) {
    console.error("[extract-details] failed to download photo:", error);
    return;
  }
  const buffer = Buffer.from(await file.arrayBuffer());

  if (data.kind === "combo") {
    const tip = data.tips[0];
    if (!tip) return;

    const { selections, totalOdd } = await extractTipDetails(buffer, data.photoPath, null);
    if (selections.length === 0 && totalOdd === null) return;

    const market = selections
      .map((s) => s.market)
      .filter((m): m is string => !!m)
      .join(" + ");
    const games = [...new Set(selections.map((s) => s.game).filter((g): g is string => !!g))];

    await prisma.telegramTip.update({
      where: { id: tip.id },
      data: {
        ...(tip.needMarket && market ? { selection: market } : {}),
        ...(tip.needGame && games.length === 1 ? { match: games[0] } : {}),
        ...(tip.needOdd && totalOdd !== null ? { odd: totalOdd, oddSource: "ocr" } : {}),
      },
    });
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
