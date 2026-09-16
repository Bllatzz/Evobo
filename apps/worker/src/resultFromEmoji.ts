import type { TelegramGroup } from "@prisma/client";
import { prisma } from "./db.js";

/** Grupos onde o tipster marca o resultado editando a própria mensagem
 * (3x ✅ = green, 3x ❌ = red) em vez de depender do bet-analytix — hoje só
 * o Super Odds faz isso. Fixo no código, mesmo padrão de
 * betAnalytix/config.ts (adicionar um grupo novo = adicionar uma linha aqui). */
export const RESULT_EMOJI_GROUP_NAMES = new Set(["ST - Super Odds de Valor"]);

/** Grupos onde o tipster marca o resultado editando a mensagem com uma linha
 * própria ("🏁 Resultado: 🟢 Green · +0,62u" / "🏁 Resultado: 🔴 Red ·
 * −1,00u") em vez do padrão 3x✅/3x❌ acima — hoje só o Padovan All Sports
 * (a "🏁 Resultado" da mensagem, não confundir com a linha "📊 Planilhada"
 * que parseTip.ts já ignora na hora de ler a tip original). Mesma convenção
 * de RESULT_EMOJI_GROUP_NAMES: adicionar um grupo novo = adicionar uma
 * linha aqui. */
export const RESULT_MARKER_GROUP_NAMES = new Set(["Padovan All Sports"]);

/** União dos dois — todo grupo onde alguma forma de edição sinaliza o
 * resultado (usado por quem precisa varrer/backfillar os dois de uma vez,
 * ver backfillResultFromEmoji.ts). */
export const RESULT_SIGNAL_GROUP_NAMES = new Set([...RESULT_EMOJI_GROUP_NAMES, ...RESULT_MARKER_GROUP_NAMES]);

const MIN_EMOJI_COUNT = 3;

function countOccurrences(text: string, char: string): number {
  return text.split(char).length - 1;
}

/** Exportado à parte de detectResultFromEmojis pra diagnóstico (ver
 * backfillResultFromEmoji.ts) — permite inspecionar POR QUE uma mensagem com
 * emoji visível não bateu (contagem insuficiente, mistura de ✅ e ❌, etc.)
 * em vez de só saber que deu null. */
export function countResultEmojis(text: string | null | undefined): { greenCount: number; redCount: number } {
  if (!text) return { greenCount: 0, redCount: 0 };
  return { greenCount: countOccurrences(text, "✅"), redCount: countOccurrences(text, "❌") };
}

/** null quando a edição não é um sinal de resultado reconhecível (edição de
 * outra coisa no texto, ou emojis insuficientes/misturados — exige pelo
 * menos 3 de um tipo e ZERO do outro, pra nunca confundir com um emoji solto
 * usado por outro motivo). */
export function detectResultFromEmojis(text: string | null | undefined): "green" | "red" | null {
  const { greenCount, redCount } = countResultEmojis(text);
  if (greenCount >= MIN_EMOJI_COUNT && redCount === 0) return "green";
  if (redCount >= MIN_EMOJI_COUNT && greenCount === 0) return "red";
  return null;
}

// "🏁 Resultado: 🟢 Green · +0,62u" / "🏁 Resultado: 🔴 Red · −1,00u" / "🏁
// Resultado: ⚪ Anulada · +0,00u" — âncora no rótulo literal "Resultado:"
// (nunca usado por esse tipster pra outra coisa) seguido da palavra em
// português/inglês; o círculo colorido antes é opcional no match pra
// tolerar variação de formatação sem quebrar. NÃO cobre "🔴½ Meio-red" /
// "🟢½ Meio-green" (resultado parcial, ex. handicap/gol-linha "meio")  de
// propósito — não existe valor de `result` pra vitória/derrota parcial no
// schema hoje (só green/red/reembolso/pending, todos "tudo ou nada"),
// arredondar pra green/red inteiro erraria o profit; fica pra revisão
// manual até decidirmos como representar isso.
const RESULT_MARKER_RE = /🏁\s*Resultado:\s*(?:🟢|🔴|⚪)?\s*(Green|Red|Anulada)\b/i;

export function detectResultFromMarker(text: string | null | undefined): "green" | "red" | "reembolso" | null {
  if (!text) return null;
  const match = text.match(RESULT_MARKER_RE);
  if (!match) return null;
  const word = match[1]!.toLowerCase();
  if (word === "green") return "green";
  if (word === "red") return "red";
  return "reembolso"; // Anulada
}

function detectResult(text: string | null | undefined, groupName: string): "green" | "red" | "reembolso" | null {
  if (RESULT_EMOJI_GROUP_NAMES.has(groupName)) return detectResultFromEmojis(text);
  if (RESULT_MARKER_GROUP_NAMES.has(groupName)) return detectResultFromMarker(text);
  return null;
}

/** Chamado pelo listener de mensagens editadas (ver index.ts) — só age nos
 * grupos cadastrados em RESULT_EMOJI_GROUP_NAMES/RESULT_MARKER_GROUP_NAMES.
 * Atualiza TODAS as TelegramTip da mensagem editada de uma vez (uma
 * múltipla com N seleções ainda é 1 mensagem só). O sinal do próprio
 * tipster é tratado como definitivo — sempre sobrescreve `result`, mesmo
 * que já tenha um (uma correção do tipster também chega editando de novo). */
export async function applyEditedMessageResult(
  messageId: number,
  messageText: string | null | undefined,
  group: TelegramGroup,
): Promise<number> {
  const result = detectResult(messageText, group.name);
  if (!result) return 0;

  const { count } = await prisma.telegramTip.updateMany({
    where: { groupId: group.id, telegramMessageId: BigInt(messageId) },
    data: { result, needsReview: false },
  });
  if (count > 0) {
    console.log(`[worker] resultado "${result}" aplicado via edição (grupo ${group.name}, msg ${messageId}) em ${count} tip(s)`);
  }
  return count;
}
