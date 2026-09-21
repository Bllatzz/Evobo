import { prisma, supabaseAdmin, PHOTO_BUCKET } from "./db.js";

const RETENTION_DAYS = 60;
const BATCH_SIZE = 200;

/**
 * Controle de custo de armazenamento: tips RESOLVIDAS (green/red/reembolso)
 * com mais de 60 dias perdem a foto (Storage) e os campos de detalhe
 * (mercado, jogo, link, texto bruto, padrão do parser) — mantendo só o que
 * GET /banca soma pra métrica (grupo, casa, unidade, odd, resultado, data).
 * O acompanhamento pessoal (TelegramTipTake — peguei/unidade/odd/casa de
 * cada usuário) é outra tabela, não é tocado aqui. Tips ainda `pending` nunca são tocadas, não importa a
 * idade: limpar antes de resolver perderia a foto que o admin precisa pra
 * decidir o resultado. Idempotente — só pega linhas que ainda têm algo pra
 * limpar, então rodar todo dia é barato mesmo sem nada novo pra fazer.
 */
export async function purgeOldTips(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.telegramTip.findMany({
    where: {
      receivedAt: { lt: cutoff },
      result: { not: "pending" },
      OR: [{ photoPath: { not: null } }, { rawMessage: { not: null } }],
    },
    select: { id: true, photoPath: true },
    take: BATCH_SIZE,
  });
  if (candidates.length === 0) return;

  const photoPaths = [...new Set(candidates.map((t) => t.photoPath).filter((p): p is string => p !== null))];

  // Uma mensagem com várias seleções (e as respostas de aumento de stake) divide
  // UMA foto entre várias tips. Se alguma tip que NÃO está sendo limpa agora
  // (pendente, mais nova ou fora deste lote) ainda aponta pro arquivo, ele
  // fica — só some quando a última tip que o usa for limpa, numa rodada futura.
  const stillUsed =
    photoPaths.length > 0
      ? await prisma.telegramTip.findMany({
          where: { photoPath: { in: photoPaths }, id: { notIn: candidates.map((t) => t.id) } },
          select: { photoPath: true },
          distinct: ["photoPath"],
        })
      : [];
  const keep = new Set(stillUsed.map((t) => t.photoPath));
  const removablePaths = photoPaths.filter((p) => !keep.has(p));

  if (removablePaths.length > 0) {
    const { error } = await supabaseAdmin.storage.from(PHOTO_BUCKET).remove(removablePaths);
    if (error) {
      // Não some as linhas do banco se o Storage falhar — tenta de novo no
      // próximo ciclo em vez de perder a referência da foto.
      console.error("[purge] falha ao remover fotos do Storage:", error);
      return;
    }
  }

  const { count } = await prisma.telegramTip.updateMany({
    where: { id: { in: candidates.map((t) => t.id) } },
    data: { photoPath: null, rawMessage: null, match: null, selection: null, betUrl: null, parsePattern: null },
  });
  console.log(`[purge] ${count} tip(s) resolvida(s) com mais de ${RETENTION_DAYS} dias tiveram a foto/detalhe removidos.`);
}
