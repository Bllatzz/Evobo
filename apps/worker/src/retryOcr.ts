import { prisma } from "./db.js";
import { extractDetailsQueue } from "./queues/extractDetailsWorker.js";

/** Re-enfileira OCR só pra tips que já existem mas ainda faltam odd/mercado/
 * jogo (a foto já foi baixada na hora, não precisa reprocessar a mensagem do
 * Telegram de novo) — nunca apaga nem recria a tip, só preenche o que falta
 * via applyMultiLegResult (ver extractDetailsWorker.ts), então grade oficial,
 * take pessoal de qualquer usuário etc. continuam intactos. */
export async function retryMissingOcr(): Promise<{ groupsEnqueued: number; tipsEnqueued: number }> {
  const candidates = await prisma.telegramTip.findMany({
    where: { photoPath: { not: null }, OR: [{ odd: null }, { match: null }, { selection: null }] },
    select: { id: true, photoPath: true, odd: true, match: true, selection: true },
  });

  const byPhoto = new Map<string, typeof candidates>();
  for (const tip of candidates) {
    const list = byPhoto.get(tip.photoPath!) ?? [];
    list.push(tip);
    byPhoto.set(tip.photoPath!, list);
  }

  for (const [photoPath, tips] of byPhoto) {
    const tipsToFill = tips.map((t) => ({
      id: t.id,
      needMarket: t.selection === null,
      needGame: t.match === null,
      needOdd: t.odd === null,
    }));
    await extractDetailsQueue.add("extract", { photoPath, kind: tips.length > 1 ? "rows" : "combo", tips: tipsToFill });
  }

  return { groupsEnqueued: byPhoto.size, tipsEnqueued: candidates.length };
}
