import { Queue, Worker } from "bullmq";
import { prisma, supabaseAdmin, PHOTO_BUCKET } from "../db.js";
import { extractTipDetails } from "../visionProvider.js";
import type { MarketType, MarketTypeCategory, OcrResult, OcrSelection } from "../ocrShared.js";

const QUEUE_NAME = "extract-details";

type TipToFill = { id: string; needMarket: boolean; needGame: boolean; needOdd: boolean; needMarketType: boolean };

/** Only set for parseTip's `unit_each_plus_combo` pattern ("<n>u em cada" +
 * "<n>u na <Rótulo>", no leg described in text) — after the combo tip
 * (`tips[0]`) is filled the normal way, one NEW TelegramTip is created per
 * leg the OCR found in the same photo, since neither the count nor any
 * individual leg only exists in the photo, never in the message text. */
type LegsSpec = {
  unit: number;
  groupId: string;
  telegramMessageId: string;
  receivedAt: string;
  match: string | null;
  bookmaker: string | null;
  betUrl: string | null;
  limit: number | null;
  rawMessage: string | null;
};

/**
 * "rows" with >1 tip: each maps 1:1 to one OCR selection, in bet-slip order
 * (parseTip's `unit_lines` pattern — genuinely independent stakes, each its
 * own odd). "rows" with exactly 1 tip, or "combo" (always 1 tip): the photo
 * may show a single selection OR several legs of one combined bet — handled
 * the same way (applyMultiLegResult), since there's no way to tell which
 * from the text alone.
 */
export type ExtractDetailsJob = { photoPath: string; kind: "rows" | "combo"; tips: TipToFill[]; legs?: LegsSpec };

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
): Promise<OcrResult> {
  const result = await extractTipDetails(buffer, photoPath, expectedCount);
  const { selections, totalOdd } = result;
  if (selections.length === 0 && totalOdd === null) return result;

  const market = selections
    .map((s) => s.market)
    .filter((m): m is string => !!m)
    .join("\n");
  // Combo de múltiplos jogos (ex.: um jogo por perna) — junta os distintos
  // com "//" em vez de só aceitar quando todas as pernas são do mesmo jogo;
  // antes disso, `match` ficava vazio de propósito sempre que a combo
  // cruzava mais de um confronto (ver marketTypes logo abaixo pro mesmo
  // padrão já usado pra "Combinada").
  const games = [...new Set(selections.map((s) => s.game).filter((g): g is string => !!g))];
  const game = games.length > 0 ? games.join(" // ") : null;
  const odd = totalOdd ?? (selections.length === 1 ? selections[0]!.odd : null);
  // Uma linha de tip pode juntar várias pernas (combo/múltipla) — se todas
  // caíram na mesma categoria, usa ela; se divergem, marca "Combinada" em vez
  // de escolher uma arbitrariamente.
  const marketTypes = [...new Set(selections.map((s) => s.marketType).filter((m): m is MarketTypeCategory => !!m))];
  const marketType: MarketType | null = marketTypes.length === 1 ? marketTypes[0]! : marketTypes.length > 1 ? "Combinada" : null;

  await prisma.telegramTip.update({
    where: { id: tipId },
    data: {
      ...(tip.needMarket && market ? { selection: market } : {}),
      ...(tip.needGame && game ? { match: game } : {}),
      ...(tip.needOdd && odd !== null ? { odd, oddSource: "ocr" } : {}),
      ...(tip.needMarketType && marketType ? { marketType } : {}),
    },
  });
  return result;
}

/** Materializa uma TelegramTip nova por perna que a OCR achou — só chamado
 * pra parseTip's `unit_each_plus_combo` (ver LegsSpec acima). Pernas sem
 * mercado legível (OCR não conseguiu ler aquela linha) são puladas: melhor
 * faltar uma perna pra edição manual do que criar uma linha totalmente
 * vazia. */
async function createLegTips(legs: LegsSpec, selections: OcrResult["selections"], photoPath: string) {
  const rows = selections.filter((s): s is OcrSelection & { market: string } => s.market !== null);
  if (rows.length === 0) return;

  await prisma.telegramTip.createMany({
    data: rows.map((s) => ({
      groupId: legs.groupId,
      telegramMessageId: BigInt(legs.telegramMessageId),
      receivedAt: new Date(legs.receivedAt),
      match: s.game ?? legs.match,
      selection: s.market,
      marketType: s.marketType,
      unit: legs.unit,
      odd: s.odd,
      oddSource: s.odd !== null ? "ocr" : null,
      originalOdd: s.odd,
      bookmaker: legs.bookmaker,
      betUrl: legs.betUrl,
      limit: legs.limit,
      photoPath,
      parsePattern: "unit_each_plus_combo",
      rawMessage: legs.rawMessage,
    })),
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
    const { selections } = await applyMultiLegResult(tip.id, tip, buffer, data.photoPath, data.kind === "combo" ? null : 1);
    if (data.legs) await createLegTips(data.legs, selections, data.photoPath);
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
        ...(tip.needOdd && sel.odd !== null ? { odd: sel.odd, oddSource: "ocr", originalOdd: sel.odd } : {}),
        ...(tip.needMarketType && sel.marketType ? { marketType: sel.marketType } : {}),
      },
    });
  }
}

export function startExtractDetailsWorker(): Worker<ExtractDetailsJob> {
  const worker = new Worker<ExtractDetailsJob>(
    QUEUE_NAME,
    async (job) => {
      await processJob(job.data);
    },
    { connection: connection() },
  );
  // Sem isso, um job que esgota as 3 tentativas (ex.: timeout do provedor de
  // visão) fica em silêncio total — nada nos logs, nada na tip, só o campo
  // continua vazio pra sempre. Isso torna visível qual foto/motivo falhou.
  worker.on("failed", (job, err) => {
    console.error(`[extract-details] job ${job?.id} falhou (photo=${job?.data?.photoPath}, tentativa ${job?.attemptsMade}):`, err?.message);
  });
  return worker;
}
