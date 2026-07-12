import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { optionalAuthGuard } from "../../middleware/authGuard.js";
import { prisma } from "../../db/prisma.js";

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

export async function searchRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string } }>(
    "/",
    { preHandler: optionalAuthGuard },
    async (request) => {
      const q = request.query.q?.trim();
      if (!q || q.length < 2) return { tipsters: [], games: [], tips: [] };

      const tipsWhere = await visibleTipsWhere(request.authUser?.id);

      const [tipsters, games, tips] = await Promise.all([
        prisma.user.findMany({
          where: {
            isActive: true,
            OR: [
              { username: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
            ],
          },
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            verifiedAt: true,
            _count: { select: { followers: true } },
          },
          take: 10,
        }),
        prisma.game.findMany({
          where: {
            OR: [
              { homeTeam: { contains: q, mode: "insensitive" } },
              { awayTeam: { contains: q, mode: "insensitive" } },
              { league: { contains: q, mode: "insensitive" } },
            ],
          },
          orderBy: { startsAt: "asc" },
          take: 10,
        }),
        prisma.tip.findMany({
          where: { market: { contains: q, mode: "insensitive" }, ...tipsWhere },
          include: {
            author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
            match: true,
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
      ]);

      return {
        tipsters: tipsters.map((t) => ({ ...t, followers: t._count.followers, _count: undefined })),
        games,
        tips,
      };
    },
  );
}
