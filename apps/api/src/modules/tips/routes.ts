import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { CreateTipInput } from "@evobo/shared-types";
import { authGuard, optionalAuthGuard } from "../../middleware/authGuard.js";
import { prisma } from "../../db/prisma.js";

// Never matches a real row — lets the "did I take this" include always have
// the same shape whether or not the request is authenticated.
const NO_VIEWER = "00000000-0000-0000-0000-000000000000";

const authorSelect = {
  select: { id: true, username: true, displayName: true, avatarUrl: true, verifiedAt: true },
} as const;

/** Mirrors the tips_select_visible RLS policy — the backend bypasses RLS via Prisma, so this has to hold on its own. */
async function visibleTipsWhere(viewerId?: string): Promise<Prisma.TipWhereInput> {
  if (!viewerId) return { visibility: "public" };

  const activeGroups = await prisma.vipSubscription.findMany({
    where: { userId: viewerId, status: "active", expiresAt: { gt: new Date() } },
    select: { vipGroupId: true },
  });

  return {
    OR: [
      { visibility: "public" },
      { authorId: viewerId },
      ...(activeGroups.length
        ? [{ vipGroupId: { in: activeGroups.map((g) => g.vipGroupId) } }]
        : []),
    ],
  };
}

export async function tipsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: optionalAuthGuard }, async (request) => {
    const viewerId = request.authUser?.id ?? NO_VIEWER;
    const where = await visibleTipsWhere(request.authUser?.id);

    const tips = await prisma.tip.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        author: authorSelect,
        match: true,
        _count: { select: { comments: true, takes: true } },
        takes: { where: { userId: viewerId }, select: { id: true } },
      },
    });

    return tips.map(({ takes, ...tip }) => ({ ...tip, takenByMe: takes.length > 0 }));
  });

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: optionalAuthGuard },
    async (request, reply) => {
      const viewerId = request.authUser?.id ?? NO_VIEWER;
      const where = await visibleTipsWhere(request.authUser?.id);

      const tip = await prisma.tip.findFirst({
        where: { id: request.params.id, ...where },
        include: {
          author: authorSelect,
          match: true,
          _count: { select: { comments: true, takes: true } },
          takes: { where: { userId: viewerId }, select: { id: true } },
        },
      });

      if (!tip) return reply.code(404).send({ error: "not_found" });

      const followedByMe = request.authUser
        ? !!(await prisma.follow.findUnique({
            where: {
              followerId_followedId: { followerId: request.authUser.id, followedId: tip.authorId },
            },
          }))
        : false;

      const { takes, ...rest } = tip;
      return { ...rest, takenByMe: takes.length > 0, followedByMe };
    },
  );

  app.post("/", { preHandler: authGuard }, async (request, reply) => {
    const parsed = CreateTipInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const input = parsed.data;

    if (input.visibility === "vip_only") {
      if (!input.vipGroupId) {
        return reply.code(400).send({ error: "vip_group_id_required" });
      }
      const group = await prisma.vipGroup.findUnique({ where: { id: input.vipGroupId } });
      if (!group || group.ownerId !== request.authUser!.id) {
        return reply.code(403).send({ error: "not_group_owner" });
      }
    }

    const tip = await prisma.tip.create({
      data: {
        authorId: request.authUser!.id,
        matchId: input.matchId,
        market: input.market,
        odds: input.odds,
        stakeUnits: input.stakeUnits,
        house: input.house,
        confidence: input.confidence,
        analysisText: input.analysisText,
        imageUrl: input.imageUrl,
        visibility: input.visibility,
        vipGroupId: input.vipGroupId,
      },
      include: { author: authorSelect, match: true },
    });

    return reply.code(201).send(tip);
  });

  app.post<{ Params: { id: string } }>("/:id/take", { preHandler: authGuard }, async (request, reply) => {
    const where = await visibleTipsWhere(request.authUser!.id);
    const tip = await prisma.tip.findFirst({ where: { id: request.params.id, ...where } });
    if (!tip) return reply.code(404).send({ error: "not_found" });

    await prisma.tipTake.upsert({
      where: { tipId_userId: { tipId: tip.id, userId: request.authUser!.id } },
      create: { tipId: tip.id, userId: request.authUser!.id },
      update: {},
    });

    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>(
    "/:id/take",
    { preHandler: authGuard },
    async (request, reply) => {
      await prisma.tipTake
        .delete({
          where: { tipId_userId: { tipId: request.params.id, userId: request.authUser!.id } },
        })
        .catch(() => null);

      return reply.code(204).send();
    },
  );
}
