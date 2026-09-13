import type { TelegramClient } from "telegram";
import bigInt from "big-integer";
import { prisma } from "./db.js";
import { applyMyReactionTake } from "./reactionTake.js";

// getMessages({ids}) já espera automaticamente 10s entre lotes acima de 300
// ids — mantém os lotes bem abaixo disso por segurança/margem.
const BATCH_SIZE = 100;

export type BackfillReactionTakeGroupResult = { group: string; checked: number; applied: number };

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
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const messages = await client.getMessages(bigInt(group.telegramChatId), { ids: batch });
      for (const message of messages) {
        if (!message) continue; // mensagem apagada — undefined no lugar dela
        applied += await applyMyReactionTake(group.id, BigInt(message.id), message.reactions);
      }
    }

    results.push({ group: group.name, checked: ids.length, applied });
  }

  return results;
}
