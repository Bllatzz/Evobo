import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { UpdateOwnProfileInput } from "@evobo/shared-types";
import { authGuard, optionalAuthGuard } from "../../middleware/authGuard.js";
import { prisma } from "../../db/prisma.js";
import { getTipsterPerformanceFor } from "../ranking/performance.js";

/** Same visibility rule as tips/routes.ts — duplicated (a few lines) to keep modules decoupled. */
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

export async function usersRoutes(app: FastifyInstance) {
  app.get("/me", { preHandler: authGuard }, async (request) => {
    return prisma.user.findUniqueOrThrow({ where: { id: request.authUser!.id } });
  });

  app.patch("/me", { preHandler: authGuard }, async (request, reply) => {
    const parsed = UpdateOwnProfileInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }

    const { displayName, avatarUrl, bio, favoriteSports } = parsed.data;
    return prisma.user.update({
      where: { id: request.authUser!.id },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(bio !== undefined && { bio }),
        ...(favoriteSports !== undefined && { favoriteSports }),
      },
    });
  });

  // Minhas apostas / P&L (Meu Perfil) — tips the caller has taken (Peguei),
  // not tips they authored. Frontend sums per-tip profit for the P&L card
  // rather than duplicating that math server-side for one screen.
  app.get("/me/bets", { preHandler: authGuard }, async (request) => {
    const takes = await prisma.tipTake.findMany({
      where: { userId: request.authUser!.id },
      orderBy: { createdAt: "desc" },
      include: {
        tip: { include: { match: true, author: { select: { username: true, displayName: true } } } },
      },
    });
    return takes.map((t) => t.tip);
  });

  // Public profile (Perfil screen).
  app.get<{ Params: { username: string } }>(
    "/:username",
    { preHandler: optionalAuthGuard },
    async (request, reply) => {
      const user = await prisma.user.findUnique({
        where: { username: request.params.username },
        include: { role: true, _count: { select: { followers: true, following: true } } },
      });

      if (!user || !user.isActive) {
        return reply.code(404).send({ error: "not_found" });
      }

      const [performance, followedByMe] = await Promise.all([
        getTipsterPerformanceFor(user.id),
        request.authUser
          ? prisma.follow
              .findUnique({
                where: {
                  followerId_followedId: { followerId: request.authUser.id, followedId: user.id },
                },
              })
              .then((f) => !!f)
          : Promise.resolve(false),
      ]);

      const { role, _count, ...profile } = user;
      return {
        ...profile,
        role: role.name,
        followers: _count.followers,
        following: _count.following,
        followedByMe,
        ...performance,
      };
    },
  );

  app.get<{ Params: { username: string } }>(
    "/:username/tips",
    { preHandler: optionalAuthGuard },
    async (request, reply) => {
      const user = await prisma.user.findUnique({ where: { username: request.params.username } });
      if (!user) return reply.code(404).send({ error: "not_found" });

      const where = await visibleTipsWhere(request.authUser?.id);
      return prisma.tip.findMany({
        where: { authorId: user.id, ...where },
        orderBy: { createdAt: "desc" },
        include: { match: true },
        take: 30,
      });
    },
  );
}
