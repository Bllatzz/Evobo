import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AUTO_BET_BOOKMAKERS, AutoBetBookmaker } from "@evobo/shared-types";
import { extensionKeyGuard } from "../../middleware/extensionKeyGuard.js";
import { prisma } from "../../db/prisma.js";
import { autoBetSettingsView } from "../auto-betting/settings.js";
import { env } from "../../config/env.js";

/**
 * Queue the Betano Chrome extension (apps/betting-extension) polls: Telegram
 * tips that carry a Betano link, grouped one task per Telegram message (a
 * combo's legs share groupId + telegramMessageId). The extension opens the
 * link, checks the odds, fills the stakes and (when not in dry-run) places
 * the bet, then reports back on POST /result — which records the user's
 * personal take and reacts 👍/👎 on the Telegram message. The official
 * record (TelegramTip odd/unit/result) is never touched here.
 *
 * Auth is the owner's extension key (see ExtensionKey / extensionKeyGuard):
 * the stake uses THAT user's unit value and the takes are written for them.
 */

const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Links de tip que MONTAM o bilhete em cada casa — só esses entram na fila.
 * Bet365: "/dl/sportsbookredirect?…&bs=…" (Padovan) e o curto "/s/r/…"
 * (Lemos), que redireciona pra ele. Link de página de jogo ("/#/AC/…")
 * não monta bilhete e fica de fora. */
const SLIP_LINKS: Record<AutoBetBookmaker, (url: string) => boolean> = {
  betano: (url) => url.includes("betano.bet.br"),
  bet365: (url) => /bet365\.bet\.br\/(dl\/sportsbookredirect|s\/r\/)/.test(url),
};
const HOST: Record<AutoBetBookmaker, string> = { betano: "betano.bet.br", bet365: "bet365.bet.br" };

/** Casa de um link de tip (pro "peguei"), ou null. */
export function bookmakerOfUrl(url: string | null): AutoBetBookmaker | null {
  if (!url) return null;
  return (AUTO_BET_BOOKMAKERS.find((b) => url.includes(HOST[b])) ?? null) as AutoBetBookmaker | null;
}

export type BettingTaskLeg = {
  tipId: string;
  match: string | null;
  selection: string | null;
  odd: number | null;
  unit: number | null;
};

export type BettingTask = {
  /** `${groupId}:${telegramMessageId}` — stable id the extension dedupes on. */
  key: string;
  bookmaker: AutoBetBookmaker;
  groupName: string;
  receivedAt: string;
  betUrl: string;
  limitReais: number | null;
  /** The singles (Simples tab). */
  legs: BettingTaskLeg[];
  /** "N simples + múltipla" messages: the múltipla tip, bet on the Múltiplas
   * tab only when every single went through. */
  multiple: BettingTaskLeg | null;
  /** A "simples + múltipla" message whose múltipla tip couldn't be told
   * apart from the singles — the extension bets nothing on it. */
  comboUnclear: boolean;
  rawMessage: string | null;
};

/** Parser patterns that create N single tips PLUS one múltipla tip for the
 * same message (apps/worker/src/parseTip.ts). */
const SINGLES_PLUS_MULTIPLE = new Set(["legs_plus_combo", "unit_lines_plus_combo", "unit_each_plus_combo", "padovan_escada_multipla"]);

/** Splits the múltipla tip out of a "simples + múltipla" message: it's the
 * one whose selection joins the legs' text with line breaks (parseTip's
 * legs_plus_combo/padovan_escada_multipla, and the OCR's applyMultiLegResult
 * for unit_each_plus_combo). Anything else is left unclear, never guessed. */
function splitMultiple(task: BettingTask, patterns: Set<string | null>, selections: Map<string, string | null>) {
  if (task.legs.length < 2 || ![...patterns].some((p) => p !== null && SINGLES_PLUS_MULTIPLE.has(p))) return;
  const joined = task.legs.filter((l) => (selections.get(l.tipId) ?? "").includes("\n"));
  if (joined.length !== 1) {
    task.comboUnclear = true;
    return;
  }
  task.multiple = joined[0]!;
  task.legs = task.legs.filter((l) => l !== task.multiple);
}

const num = (d: { toNumber(): number } | null) => (d === null ? null : d.toNumber());

const bettorSettings = (userId: string) => prisma.telegramBancaSettings.findUnique({ where: { userId } });

const ResultInput = z.object({
  key: z.string().regex(/^[0-9a-f-]{36}:\d+$/),
  legs: z
    .array(
      z.object({
        tipId: z.string().uuid(),
        placed: z.boolean(),
        /** Odd the bet actually went through at (from the receipt/slip). */
        realOdd: z.number().positive().nullable(),
        stakeReais: z.number().positive().nullable(),
      }),
    )
    .min(1),
  betId: z.string().max(80).nullable().optional(),
});

export async function bettingQueueRoutes(app: FastifyInstance) {
  app.addHook("preHandler", extensionKeyGuard);

  // Liga/desliga, modo e teto vêm do perfil do Evobo (auto_bet_settings) e
  // vão junto da fila — a extensão não guarda configuração própria.
  // Desligado = fila vazia. Só entram tips recebidas depois de ligar
  // (enabledSince) e que ainda não têm linha no histórico (auto_bet_runs),
  // então reiniciar o navegador nunca reprocessa uma tip.
  app.get<{ Params: { bookmaker: string }; Querystring: { since?: string } }>("/:bookmaker", async (request, reply) => {
    const parsedBookmaker = AutoBetBookmaker.safeParse(request.params.bookmaker);
    if (!parsedBookmaker.success) return reply.code(404).send({ error: "unsupported_bookmaker" });
    const bookmaker = parsedBookmaker.data;
    const userId = request.authUser!.id;
    const settings = await autoBetSettingsView(userId);
    if (!settings.enabled || !settings.enabledSince) return { settings, unitValueReais: settings.unitValueReais, tasks: [] };

    const since = request.query.since ? new Date(request.query.since) : new Date(0);
    if (Number.isNaN(since.getTime())) return reply.code(400).send({ error: "invalid_since" });
    const floor = new Date(Math.max(since.getTime(), new Date(settings.enabledSince).getTime(), Date.now() - MAX_LOOKBACK_MS));

    const tips = await prisma.telegramTip.findMany({
      where: {
        receivedAt: { gte: floor },
        result: "pending",
        betUrl: { contains: HOST[bookmaker] },
        // Tip adicionada à mão no Admin (id de mensagem negativo) já foi
        // apostada/enviada em outro lugar — nunca entra na aposta automática.
        telegramMessageId: { gt: 0 },
      },
      include: { group: { select: { name: true } } },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    });

    const byMessage = new Map<string, BettingTask>();
    const patterns = new Map<string, Set<string | null>>();
    const selections = new Map<string, string | null>();
    for (const t of tips) {
      if (!SLIP_LINKS[bookmaker](t.betUrl!)) continue;
      const key = `${t.groupId}:${t.telegramMessageId}`;
      let task = byMessage.get(key);
      if (!task) {
        task = {
          key,
          bookmaker,
          groupName: t.group.name,
          receivedAt: t.receivedAt.toISOString(),
          betUrl: t.betUrl!,
          limitReais: num(t.limit),
          legs: [],
          multiple: null,
          comboUnclear: false,
          rawMessage: t.rawMessage,
        };
        byMessage.set(key, task);
        patterns.set(key, new Set());
      }
      patterns.get(key)!.add(t.parsePattern);
      selections.set(t.id, t.selection);
      task.legs.push({ tipId: t.id, match: t.match, selection: t.selection, odd: num(t.odd), unit: num(t.unit) });
    }

    for (const [key, task] of byMessage) splitMultiple(task, patterns.get(key)!, selections);

    const keys = [...byMessage.keys()];
    const done = keys.length
      ? await prisma.autoBetRun.findMany({ where: { userId, taskKey: { in: keys } }, select: { taskKey: true } })
      : [];
    const doneKeys = new Set(done.map((r) => r.taskKey));

    // Stake = unit × the owner's unit value ("Unidade & saldos").
    return { settings, unitValueReais: settings.unitValueReais, tasks: [...byMessage.values()].filter((t) => !doneKeys.has(t.key)) };
  });

  // Only called for a REAL run (never dry-run). Order (pedido do usuário,
  // 2026-09-24): react on the Telegram message FIRST, then record each leg —
  // placed legs become "taken" with the real odd (≥ the tip's — a lower odd
  // is never placed, and the official record keeps the tip's odd) and the
  // unit actually staked; skipped legs become "skipped" unless the user
  // already decided them.
  app.post("/result", async (request, reply) => {
    const parsed = ResultInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const { key, legs, betId } = parsed.data;
    const [groupId, messageId] = key.split(":") as [string, string];

    const userId = request.authUser!.id;
    const settings = await bettorSettings(userId);
    if (!settings?.unitValue) return reply.code(409).send({ error: "no_unit_value" });
    const unitValue = settings.unitValue.toNumber();

    const tips = await prisma.telegramTip.findMany({
      where: { id: { in: legs.map((l) => l.tipId) }, groupId, telegramMessageId: BigInt(messageId) },
    });
    if (tips.length !== legs.length) return reply.code(400).send({ error: "tips_do_not_match_key" });

    // 👍 when at least one leg went through (e.g. 2 of 3 singles, the third
    // suspended), 👎 only when nothing did. The reaction listener would mark
    // EVERY tip of the message from that emoji — sendMyReaction tells it to
    // ignore this echo, and the per-leg takes below are the real record.
    const placedCount = legs.filter((l) => l.placed).length;
    // A reação sai pela conta do Telegram do worker, que é a do dono
    // (OWNER_USER_ID) — pra outro usuário ela marcaria a tip na conta do
    // dono. Pros outros fica só o "peguei" abaixo.
    const isOwner = !!env.OWNER_USER_ID && env.OWNER_USER_ID === userId;
    const emoji = !isOwner ? null : placedCount > 0 ? "👍" : "👎";
    let reaction: string | null = null;
    if (emoji) {
      try {
        const { reactToTipMessage } = await import("@evobo/worker");
        await reactToTipMessage(groupId, BigInt(messageId), emoji);
        reaction = emoji;
      } catch (err) {
        request.log.error({ err, key }, "betting-queue: failed to react on the Telegram message");
      }
    }

    for (const leg of legs) {
      const tip = tips.find((t) => t.id === leg.tipId)!;
      if (leg.placed) {
        const data = {
          takenStatus: "taken",
          odd: leg.realOdd,
          unit: leg.stakeReais !== null ? Math.round((leg.stakeReais / unitValue) * 100) / 100 : num(tip.unit),
          bookmaker: bookmakerOfUrl(tip.betUrl) ?? "betano",
          betUrl: tip.betUrl,
        };
        await prisma.telegramTipTake.upsert({
          where: { tipId_userId: { tipId: tip.id, userId } },
          create: { tipId: tip.id, userId, ...data },
          update: data,
        });
      } else {
        const existing = await prisma.telegramTipTake.findUnique({ where: { tipId_userId: { tipId: tip.id, userId } } });
        if (!existing) {
          await prisma.telegramTipTake.create({ data: { tipId: tip.id, userId, takenStatus: "skipped" } });
        }
      }
    }

    request.log.info({ key, betId, placedCount, legs: legs.length, reaction }, "betting-queue: result recorded");
    return { ok: true, reaction };
  });
}
