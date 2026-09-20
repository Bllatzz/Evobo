import type { TelegramClient } from "telegram";
import bigInt from "big-integer";
import { prisma } from "./db.js";
import {
  applyEditedMessageResult,
  countResultEmojis,
  detectLegResults,
  detectResult,
  RESULT_EMOJI_GROUP_NAMES,
  RESULT_MARKER_GROUP_NAMES,
  RESULT_SIGNAL_GROUP_NAMES,
} from "./resultFromEmoji.js";

// getMessages({ids}) já espera automaticamente 10s entre lotes acima de 300
// ids — mantém os lotes bem abaixo disso por segurança/margem.
const BATCH_SIZE = 100;
const MAX_UNMATCHED_SAMPLES = 20;

export type BackfillResultFromEmojiGroupResult = {
  group: string;
  checked: number;
  applied: number;
  /** Mensagens com algum sinal de resultado visível que MESMO ASSIM não
   * bateram o critério (✅/❌ insuficiente ou misturado nos grupos de
   * RESULT_EMOJI_GROUP_NAMES; a palavra "Resultado" presente mas a linha não
   * reconhecida nos de RESULT_MARKER_GROUP_NAMES) — cap de
   * MAX_UNMATCHED_SAMPLES por grupo pra não inchar a resposta. */
  unmatched: { messageId: number; reason: string; text: string }[];
};

/** Aplica o sinal de resultado retroativamente nas mensagens JÁ IMPORTADAS
 * dos grupos de RESULT_SIGNAL_GROUP_NAMES (✅✅✅/❌❌❌ ou a linha "🏁
 * Resultado: ...", ver resultFromEmoji.ts) — cobre edições que o tipster já
 * tinha feito ANTES do listener ao vivo existir. Busca o texto ATUAL de
 * cada mensagem direto do Telegram (getMessages sempre retorna o estado
 * mais recente, edições incluídas) e reusa a mesma lógica do listener ao
 * vivo. Reusa a sessão MTProto já conectada do worker — nunca abrir uma 2ª
 * conexão com a mesma TELEGRAM_SESSION. */
export async function backfillResultFromEmoji(
  client: TelegramClient,
): Promise<BackfillResultFromEmojiGroupResult[]> {
  const groups = await prisma.telegramGroup.findMany({
    where: { name: { in: [...RESULT_SIGNAL_GROUP_NAMES] } },
  });

  const results: BackfillResultFromEmojiGroupResult[] = [];

  for (const group of groups) {
    const tips = await prisma.telegramTip.findMany({
      where: { groupId: group.id },
      select: { telegramMessageId: true },
      distinct: ["telegramMessageId"],
    });
    const ids = tips.map((t) => Number(t.telegramMessageId));

    let applied = 0;
    const unmatched: BackfillResultFromEmojiGroupResult["unmatched"] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const messages = await client.getMessages(bigInt(group.telegramChatId), { ids: batch });
      for (const message of messages) {
        if (!message) continue; // mensagem apagada — undefined no lugar dela
        // Detecta ANTES de aplicar pra distinguir "não achei sinal nenhum" de
        // "achei um sinal, mas não escrevi" (mensagem com >1 tip, ou
        // `result` que já não estava "pending" — ver applyEditedMessageResult).
        const detected = detectResult(message.message, group.name);
        const legs = RESULT_MARKER_GROUP_NAMES.has(group.name) ? detectLegResults(message.message) : [];
        const count = await applyEditedMessageResult(message.id, message.message, group);
        applied += count;

        if (count === 0 && unmatched.length < MAX_UNMATCHED_SAMPLES) {
          if (legs.length > 0) {
            unmatched.push({
              messageId: message.id,
              reason: `${legs.length} perna(s) com resultado, nenhuma aplicada (texto não bate com exatamente 1 tip, ou já não estava "pending")`,
              text: message.message ?? "",
            });
          } else if (detected !== null) {
            unmatched.push({
              messageId: message.id,
              reason: `detectei "${detected}" mas não apliquei (mensagem com mais de 1 tip, ou resultado que já não estava "pending")`,
              text: message.message ?? "",
            });
          } else if (RESULT_EMOJI_GROUP_NAMES.has(group.name)) {
            const { greenCount, redCount } = countResultEmojis(message.message);
            if (greenCount > 0 || redCount > 0) {
              unmatched.push({ messageId: message.id, reason: `✅=${greenCount} ❌=${redCount}`, text: message.message ?? "" });
            }
          } else if (RESULT_MARKER_GROUP_NAMES.has(group.name) && (message.message?.includes("Resultado") || message.message?.includes("🏁"))) {
            unmatched.push({ messageId: message.id, reason: "linha \"Resultado\"/\"🏁\" presente mas não reconhecida", text: message.message ?? "" });
          }
        }
      }
    }

    results.push({ group: group.name, checked: ids.length, applied, unmatched });
  }

  return results;
}
