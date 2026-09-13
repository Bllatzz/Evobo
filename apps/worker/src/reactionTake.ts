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
 * custom/paga, ou qualquer emoji sem sentido pra peguei/não peguei). */
function extractMyReactionEmoji(reactions: Api.TypeMessageReactions | undefined): string | null {
  if (!reactions) return null;
  for (const r of reactions.results) {
    if (r.chosenOrder === undefined) continue;
    if (r.reaction instanceof Api.ReactionEmoji) return r.reaction.emoticon;
  }
  return null;
}

/** Chamado pelo listener de reações (ver index.ts, evento Raw filtrado por
 * UpdateMessageReactions) — 👍 marca "peguei", 👎 marca "não peguei" pra
 * REACTION_TAKEN_USER_ID, em todas as tips daquela mensagem. Ao criar a take
 * pela primeira vez (peguei), pré-preenche unit/odd/bookmaker/betUrl com o
 * valor OFICIAL da tip, igual ao botão "Peguei" da tela pessoal — mas nunca
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

  const tips = await prisma.telegramTip.findMany({
    where: { groupId, telegramMessageId },
    select: { id: true, unit: true, odd: true, bookmaker: true, betUrl: true },
  });
  if (tips.length === 0) return 0;

  await Promise.all(
    tips.map((tip) =>
      prisma.telegramTipTake.upsert({
        where: { tipId_userId: { tipId: tip.id, userId: REACTION_TAKEN_USER_ID } },
        create: {
          tipId: tip.id,
          userId: REACTION_TAKEN_USER_ID,
          takenStatus,
          ...(takenStatus === "taken"
            ? { unit: tip.unit, odd: tip.odd, bookmaker: tip.bookmaker, betUrl: tip.betUrl }
            : {}),
        },
        update: { takenStatus },
      }),
    ),
  );

  console.log(`[worker] reação ${emoji} -> "${takenStatus}" aplicada em ${tips.length} tip(s) (msg ${telegramMessageId})`);
  return tips.length;
}
