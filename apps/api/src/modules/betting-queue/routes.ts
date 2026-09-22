import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { extensionKeyGuard } from "../../middleware/extensionKeyGuard.js";
import { prisma } from "../../db/prisma.js";

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
  groupName: string;
  receivedAt: string;
  betUrl: string;
  limitReais: number | null;
  legs: BettingTaskLeg[];
  rawMessage: string | null;
};

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

  app.get<{ Querystring: { since?: string } }>("/betano", async (request, reply) => {
    const since = request.query.since ? new Date(request.query.since) : new Date(Date.now() - 60 * 60 * 1000);
    if (Number.isNaN(since.getTime())) return reply.code(400).send({ error: "invalid_since" });
    const floor = new Date(Math.max(since.getTime(), Date.now() - MAX_LOOKBACK_MS));

    const tips = await prisma.telegramTip.findMany({
      where: {
        receivedAt: { gte: floor },
        result: "pending",
        betUrl: { contains: "betano.bet.br" },
      },
      include: { group: { select: { name: true } } },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    });

    const byMessage = new Map<string, BettingTask>();
    for (const t of tips) {
      const key = `${t.groupId}:${t.telegramMessageId}`;
      let task = byMessage.get(key);
      if (!task) {
        task = {
          key,
          groupName: t.group.name,
          receivedAt: t.receivedAt.toISOString(),
          betUrl: t.betUrl!,
          limitReais: num(t.limit),
          legs: [],
          rawMessage: t.rawMessage,
        };
        byMessage.set(key, task);
      }
      task.legs.push({ tipId: t.id, match: t.match, selection: t.selection, odd: num(t.odd), unit: num(t.unit) });
    }

    // Stake = unit × the owner's configured unit value (Banca settings).
    const settings = await bettorSettings(request.authUser!.id);
    return { unitValueReais: num(settings?.unitValue ?? null), tasks: [...byMessage.values()] };
  });

  // Only called for a REAL run (never dry-run). Placed legs become "taken"
  // with the real odd (≥ the tip's — a lower odd is never placed, and the
  // official record keeps the tip's odd) and the unit actually staked;
  // skipped legs become "skipped" unless the user already decided them.
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

    for (const leg of legs) {
      const tip = tips.find((t) => t.id === leg.tipId)!;
      if (leg.placed) {
        const data = {
          takenStatus: "taken",
          odd: leg.realOdd,
          unit: leg.stakeReais !== null ? Math.round((leg.stakeReais / unitValue) * 100) / 100 : num(tip.unit),
          bookmaker: "betano",
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

    // The reaction is per message and the reaction listener applies its
    // status to EVERY tip of that message — so a mixed result (some legs
    // placed, some skipped) gets no reaction, or it would overwrite the
    // skipped legs as taken (or vice versa).
    const placedCount = legs.filter((l) => l.placed).length;
    const emoji = placedCount === legs.length ? "👍" : placedCount === 0 ? "👎" : null;
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

    request.log.info({ key, betId, placedCount, legs: legs.length, reaction }, "betting-queue: result recorded");
    return { ok: true, reaction };
  });
}
