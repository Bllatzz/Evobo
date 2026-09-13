import { Api } from "telegram/tl/index.js";
import { prisma } from "./db.js";

/// bllatz (admin) — a única conta Telegram logada no worker via
/// TELEGRAM_SESSION, então toda reação capturada é sempre dela. Fixo no
/// código de propósito (mesmo padrão de betAnalytix/config.ts e
/// resultFromEmoji.ts): não existe hoje uma tela pra mapear "qual conta
/// Telegram é qual usuário do app", e só há um usuário de verdade usando
/// essa conta.
const REACTION_TAKEN_USER_ID = "8d779784-8159-457b-bc93-70fb093530e7";

const REACTION_TO_TAKEN_STATUS: Record<string, "taken" | "skipped"> = {
  "👍": "taken",
  "👎": "skipped",
};

/** Emoji da PRÓPRIA conta (a logada no worker) entre as reações de uma
 * mensagem — `chosenOrder` só vem preenchido na entrada da reação que essa
 * conta deu, nunca nas dos outros membros do grupo. null se a conta não
 * reagiu, ou reagiu com algo fora de REACTION_TO_TAKEN_STATUS (reação
 * custom/paga, ou qualquer emoji sem sentido pra peguei/não peguei).
 *
 * Checa a presença de `emoticon` em vez de `instanceof Api.ReactionEmoji`:
 * em produção esse `instanceof` nunca bateu (confirmado via log — a reação
 * chegava certinha, com `chosenOrder` preenchido e `emoticon` presente, mas
 * o `instanceof` rejeitava o objeto mesmo assim), deixando toda reação
 * silenciosamente sem efeito. */
function extractMyReactionEmoji(reactions: Api.TypeMessageReactions | undefined): string | null {
  if (!reactions) return null;
  for (const r of reactions.results) {
    if (r.chosenOrder === undefined) continue;
    if ("emoticon" in r.reaction) return r.reaction.emoticon as string;
  }
  return null;
}

/** Mesma regra de apps/api's applyStakeLimit (routes.ts) — se a tip tem
 * `limit` (R$) e a unidade oficial, convertida em reais pelo unitValue (R$/u)
 * da Banca de REACTION_TAKEN_USER_ID, passa desse limite, a unidade EFETIVA
 * vira limite ÷ unitValue. Sem `limit` na tip ou sem unitValue configurado,
 * devolve a unidade como veio, sem marcar. Duplicado (não compartilhado
 * entre worker/api) por ser uma fórmula pura pequena — se divergir da versão
 * da API, atualizar as duas. */
function applyStakeLimit(
  limit: number | null,
  requestedUnit: number | null,
  unitValueRs: number | null,
): { unit: number | null; limitApplied: boolean } {
  if (requestedUnit === null || limit === null || unitValueRs === null || unitValueRs <= 0) {
    return { unit: requestedUnit, limitApplied: false };
  }
  const requestedRs = requestedUnit * unitValueRs;
  if (requestedRs <= limit) return { unit: requestedUnit, limitApplied: false };
  return { unit: Math.round((limit / unitValueRs) * 100) / 100, limitApplied: true };
}

/** Chamado pelo listener de reações (ver index.ts, evento Raw filtrado por
 * UpdateMessageReactions) — 👍 marca "peguei", 👎 marca "não peguei" pra
 * REACTION_TAKEN_USER_ID, em todas as tips daquela mensagem. Ao criar a take
 * pela primeira vez (peguei), pré-preenche unit/odd/bookmaker/betUrl com o
 * valor OFICIAL da tip (a unidade já passando pelo limite de aposta da casa,
 * ver applyStakeLimit), igual ao botão "Peguei" da tela pessoal — mas nunca
 * sobrescreve esses campos numa reação repetida (só o status), pra não
 * perder uma edição manual feita depois pela tela. Tirar a reação não desfaz
 * nada — usa a tela pra corrigir. */
export async function applyMyReactionTake(
  groupId: string,
  telegramMessageId: bigint,
  reactions: Api.TypeMessageReactions | undefined,
): Promise<number> {
  const emoji = extractMyReactionEmoji(reactions);
  const takenStatus = emoji ? REACTION_TO_TAKEN_STATUS[emoji] : undefined;
  if (!takenStatus) return 0;

  const [tips, settings] = await Promise.all([
    prisma.telegramTip.findMany({
      where: { groupId, telegramMessageId },
      select: { id: true, unit: true, odd: true, bookmaker: true, betUrl: true, limit: true },
    }),
    prisma.telegramBancaSettings.findUnique({ where: { userId: REACTION_TAKEN_USER_ID }, select: { unitValue: true } }),
  ]);
  if (tips.length === 0) return 0;
  const unitValueRs = settings?.unitValue != null ? Number(settings.unitValue) : null;

  await Promise.all(
    tips.map((tip) => {
      const limitRs = tip.limit != null ? Number(tip.limit) : null;
      const officialUnit = tip.unit != null ? Number(tip.unit) : null;
      const capped = takenStatus === "taken" ? applyStakeLimit(limitRs, officialUnit, unitValueRs) : null;

      return prisma.telegramTipTake.upsert({
        where: { tipId_userId: { tipId: tip.id, userId: REACTION_TAKEN_USER_ID } },
        create: {
          tipId: tip.id,
          userId: REACTION_TAKEN_USER_ID,
          takenStatus,
          ...(capped
            ? { unit: capped.unit, limitApplied: capped.limitApplied, odd: tip.odd, bookmaker: tip.bookmaker, betUrl: tip.betUrl }
            : {}),
        },
        update: { takenStatus },
      });
    }),
  );

  console.log(`[worker] reação ${emoji} -> "${takenStatus}" aplicada em ${tips.length} tip(s) (msg ${telegramMessageId})`);
  return tips.length;
}
