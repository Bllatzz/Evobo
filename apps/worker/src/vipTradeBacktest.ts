import type { TelegramClient } from "telegram";
import { fetchMessagesSince } from "./backfillRange.js";

const STAKE_RE = /stake\s*:?\s*(\d+(?:[.,]\d+)?)\s*%/i;
const ODD_RE = /odd\s*:?\s*(\d+(?:[.,]\d+)?)/i;
const GREEN_MARK_RE = /✅/;
// Green às vezes não vem como edição da própria mensagem, e sim como uma
// REPLY separada consistindo só em ✅ (nada mais) — precisa ser "pura" pra
// não confundir com um recap do dia tipo "8 ✅ 1 💔", que também tem ✅ mas
// não é uma confirmação da tip específica.
const PURE_CHECKMARK_RE = /^[✅\s]+$/;

function toNumber(raw: string): number {
  return parseFloat(raw.replace(",", "."));
}

export type VipBacktestTip = {
  telegramMessageId: number;
  date: string;
  stakePercent: number;
  stakeReais: number;
  odd: number;
  result: "green" | "red";
  profitReais: number;
  text: string;
};

export type VipBacktestResult = {
  groupTitle: string;
  since: string;
  until: string;
  totalMessages: number;
  tipsFound: number;
  green: number;
  red: number;
  stakedReais: number;
  profitReais: number;
  roi: number | null;
  skippedNoStakeOrOdd: number;
  /** Amostra do texto de mensagens puladas (sem STAKE/ODD reconhecíveis) —
   * só pra conferir que não é um formato de tip válido escapando do regex,
   * nunca usado no cálculo. */
  skippedSamples: string[];
  /** Quantas tips só foram identificadas como green por causa da reply
   * separada de puro ✅ (a própria mensagem nunca foi editada) — indica o
   * quanto essa correção importou, nunca usado no cálculo em si. */
  greenOnlyViaReply: number;
  tips: VipBacktestTip[];
};

/**
 * Backtest de ROI só-leitura pra um grupo que NUNCA passou pelo pipeline
 * normal de TelegramTip — nunca grava no banco, nunca chama OCR. Toda
 * mensagem de tip desse grupo já traz stake (%) e odd no próprio texto (ao
 * contrário dos grupos Padovan/Lemos, que dependem de foto), e green é o
 * tipster EDITANDO a mensagem original com vários ✅; red é silêncio (nunca
 * edita nada). Reusa o client já conectado do worker (nunca abre uma 2ª
 * conexão MTProto — ver o comentário de fetchMessagesSince em
 * backfillRange.ts sobre por que isso derrubaria a sessão ao vivo).
 */
export async function runVipTradeBacktest(
  client: TelegramClient,
  groupNameOrChatId: string,
  sinceUnix: number,
  untilUnix: number,
  reaisPerPercent: number,
): Promise<VipBacktestResult> {
  const dialogs = await client.getDialogs({});
  const dialog = dialogs.find(
    (d) => d.id?.toString() === groupNameOrChatId || d.title?.trim().toLowerCase() === groupNameOrChatId.trim().toLowerCase(),
  );
  if (!dialog?.id) {
    // Nome exato não bateu — sugere os títulos mais parecidos (substring em
    // qualquer direção) em vez de só falhar, pra não precisar de uma 2ª
    // rodada de tentativa e erro só pra descobrir a grafia certa.
    const needle = groupNameOrChatId.trim().toLowerCase();
    const suggestions = dialogs
      .map((d) => d.title)
      .filter((t): t is string => !!t && (t.toLowerCase().includes(needle.split(" ")[0] ?? needle) || needle.includes(t.toLowerCase())))
      .slice(0, 15);
    throw new Error(
      `grupo "${groupNameOrChatId}" não encontrado nos diálogos da conta conectada. Sugestões: ${suggestions.join(" | ") || "(nenhuma parecida)"}`,
    );
  }

  const messages = await fetchMessagesSince(client, dialog.id.toString(), sinceUnix, untilUnix);

  // Replies de puro ✅ apontando pra uma tip específica — a outra forma de
  // confirmar green além de editar a própria mensagem (ver PURE_CHECKMARK_RE).
  const pureCheckmarkRepliesTo = new Set<number>();
  for (const msg of messages) {
    if (msg.replyToMsgId !== undefined && msg.message && PURE_CHECKMARK_RE.test(msg.message)) {
      pureCheckmarkRepliesTo.add(msg.replyToMsgId);
    }
  }

  const tips: VipBacktestTip[] = [];
  const skippedSamples: string[] = [];
  let skipped = 0;
  let greenOnlyViaReply = 0;

  for (const msg of messages) {
    const text = msg.message;
    if (!text) continue;
    const stakeMatch = text.match(STAKE_RE);
    const oddMatch = text.match(ODD_RE);
    if (!stakeMatch || !oddMatch) {
      skipped++;
      if (skippedSamples.length < 20) skippedSamples.push(`[replyTo=${msg.replyToMsgId ?? "none"}] ${text}`);
      continue;
    }

    const stakePercent = toNumber(stakeMatch[1]!);
    const odd = toNumber(oddMatch[1]!);
    const stakeReais = stakePercent * reaisPerPercent;
    const greenViaEdit = GREEN_MARK_RE.test(text);
    const greenViaReply = pureCheckmarkRepliesTo.has(msg.id);
    if (greenViaReply && !greenViaEdit) greenOnlyViaReply++;
    const isGreen = greenViaEdit || greenViaReply;
    const profitReais = isGreen ? stakeReais * (odd - 1) : -stakeReais;

    tips.push({
      telegramMessageId: msg.id,
      date: new Date(msg.date * 1000).toISOString(),
      stakePercent,
      stakeReais,
      odd,
      result: isGreen ? "green" : "red",
      profitReais,
      text,
    });
  }

  const stakedReais = tips.reduce((sum, t) => sum + t.stakeReais, 0);
  const profitReais = tips.reduce((sum, t) => sum + t.profitReais, 0);

  return {
    groupTitle: dialog.title ?? groupNameOrChatId,
    since: new Date(sinceUnix * 1000).toISOString(),
    until: new Date(untilUnix * 1000).toISOString(),
    totalMessages: messages.length,
    tipsFound: tips.length,
    green: tips.filter((t) => t.result === "green").length,
    red: tips.filter((t) => t.result === "red").length,
    stakedReais,
    profitReais,
    roi: stakedReais > 0 ? profitReais / stakedReais : null,
    skippedNoStakeOrOdd: skipped,
    skippedSamples,
    greenOnlyViaReply,
    tips,
  };
}
