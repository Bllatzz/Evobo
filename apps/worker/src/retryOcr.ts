import { prisma } from "./db.js";
import { extractDetailsQueue } from "./queues/extractDetailsWorker.js";

/** Re-enfileira OCR só pra tips que já existem mas ainda faltam odd/mercado/
 * jogo (a foto já foi baixada na hora, não precisa reprocessar a mensagem do
 * Telegram de novo) — nunca apaga nem recria a tip, só preenche o que falta
 * via applyMultiLegResult (ver extractDetailsWorker.ts), então grade oficial,
 * take pessoal de qualquer usuário etc. continuam intactos. */
export async function retryMissingOcr(): Promise<{ groupsEnqueued: number; tipsEnqueued: number }> {
  const candidates = await prisma.telegramTip.findMany({
    // `selection` fica "" (não null) quando a tip é criada sem mercado no
    // texto — as duas formas contam como "faltando" (ver o mesmo tratamento
    // no filtro "Mercado faltando" do admin, routes.ts).
    where: { photoPath: { not: null }, OR: [{ odd: null }, { match: null }, { selection: null }, { selection: "" }] },
    select: { id: true, photoPath: true, odd: true, match: true, selection: true, marketType: true },
  });

  const byPhoto = new Map<string, typeof candidates>();
  for (const tip of candidates) {
    const list = byPhoto.get(tip.photoPath!) ?? [];
    list.push(tip);
    byPhoto.set(tip.photoPath!, list);
  }

  // Mesma tolerância a instabilidade transitória (ex.: o túnel do Ollama
  // cair um instante) que processMessage.ts já usa pro OCR de mensagem nova.
  const retryOpts = { attempts: 3, backoff: { type: "exponential" as const, delay: 5_000 } };

  for (const [photoPath, tips] of byPhoto) {
    const tipsToFill = tips.map((t) => ({
      id: t.id,
      needMarket: t.selection === null || t.selection === "",
      needGame: t.match === null,
      needOdd: t.odd === null,
      // Não entra no critério de seleção acima (não vale reprocessar o
      // histórico inteiro só pra classificar mercado) — mas de carona nessas
      // tips que já vão ser reenviadas à OCR por outro motivo, preenche
      // também se ainda não tiver.
      needMarketType: t.marketType === null,
    }));
    await extractDetailsQueue.add("extract", { photoPath, kind: tips.length > 1 ? "rows" : "combo", tips: tipsToFill }, retryOpts);
  }

  return { groupsEnqueued: byPhoto.size, tipsEnqueued: candidates.length };
}

/** OCR de uma tip só — usada pela tip adicionada à mão no Admin (foto enviada
 * pelo navegador, não baixada do Telegram). Preenche só o que veio vazio. */
export async function enqueueTipOcr(tip: {
  id: string;
  photoPath: string;
  needMarket: boolean;
  needGame: boolean;
  needOdd: boolean;
}): Promise<void> {
  const retryOpts = { attempts: 3, backoff: { type: "exponential" as const, delay: 5_000 } };
  await extractDetailsQueue.add(
    "extract",
    {
      photoPath: tip.photoPath,
      kind: "combo",
      tips: [{ id: tip.id, needMarket: tip.needMarket, needGame: tip.needGame, needOdd: tip.needOdd, needMarketType: true }],
    },
    retryOpts,
  );
}
