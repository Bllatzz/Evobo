import type { TelegramClient } from "telegram";
import bigInt from "big-integer";
import { prisma } from "./db.js";
import { applyMyReactionTake } from "./reactionTake.js";

// getMessages({ids}) já espera automaticamente 10s entre lotes acima de 300
// ids — mantém os lotes bem abaixo disso por segurança/margem.
const BATCH_SIZE = 100;

const MAX_SAMPLES = 20;

export type BackfillReactionTakeGroupResult = {
  group: string;
  checked: number;
  applied: number;
  /** Diagnóstico: mensagens que TÊM alguma reação registrada, com o detalhe
   * cru de cada uma (emoji + chosenOrder) — inclui as que não bateram, pra
   * enxergar se a própria conta aparece ali ou não. Cap de MAX_SAMPLES. */
  samples: { messageId: number; reactions: { emoji: string | null; count: number; chosenOrder: number | null }[] }[];
};

/** Aplica retroativamente 👍/👎 que a conta do worker já tinha dado ANTES do
 * listener de reação existir (ver reactionTake.ts) — getMessages sempre
 * devolve `reactions` com `chosenOrder` preenchido pra reação da PRÓPRIA
 * conta, então basta reler o estado atual de cada mensagem já importada e
 * rodar a mesma lógica do listener ao vivo. Cobre TODOS os grupos ativos
 * (o sinal de reação vale pra qualquer um, ver reactionTake.ts). Reusa a
 * sessão MTProto já conectada do worker — nunca abrir uma 2ª conexão com a
 * mesma TELEGRAM_SESSION. */
export async function backfillReactionTake(client: TelegramClient): Promise<BackfillReactionTakeGroupResult[]> {
  const groups = await prisma.telegramGroup.findMany({ where: { active: true } });
  const results: BackfillReactionTakeGroupResult[] = [];

  for (const group of groups) {
    const tips = await prisma.telegramTip.findMany({
      where: { groupId: group.id },
      select: { telegramMessageId: true },
      distinct: ["telegramMessageId"],
    });
    const ids = tips.map((t) => Number(t.telegramMessageId));

    let applied = 0;
    const samples: BackfillReactionTakeGroupResult["samples"] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const messages = await client.getMessages(bigInt(group.telegramChatId), { ids: batch });
      for (const message of messages) {
        if (!message) continue; // mensagem apagada — undefined no lugar dela
        applied += await applyMyReactionTake(group.id, BigInt(message.id), message.reactions);

        const rawResults = message.reactions?.results ?? [];
        if (rawResults.length > 0 && samples.length < MAX_SAMPLES) {
          samples.push({
            messageId: message.id,
            reactions: rawResults.map((r) => ({
              emoji: "emoticon" in r.reaction ? (r.reaction.emoticon as string) : null,
              count: r.count,
              chosenOrder: r.chosenOrder ?? null,
            })),
          });
        }
      }
    }

    results.push({ group: group.name, checked: ids.length, applied, samples });
  }

  return results;
}
