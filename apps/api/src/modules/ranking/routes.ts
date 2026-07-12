import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/prisma.js";
import { getTipsterPerformance } from "./performance.js";

export async function rankingRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { sort?: string } }>("/", async (request) => {
    const perf = await getTipsterPerformance();
    const authorIds = [...perf.keys()];
    if (authorIds.length === 0) return [];

    const users = await prisma.user.findMany({
      where: { id: { in: authorIds }, isActive: true },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        verifiedAt: true,
        _count: { select: { followers: true } },
      },
    });

    const sortKey = request.query.sort === "hitrate" ? "hitRate" : "roi";

    const ranked = users.map((u) => {
      const stats = perf.get(u.id)!;
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        verifiedAt: u.verifiedAt,
        followers: u._count.followers,
        tipsCount: stats.tipsCount,
        greenCount: stats.greenCount,
        redCount: stats.redCount,
        roi: stats.roi,
        hitRate: stats.hitRate,
      };
    });

    ranked.sort((a, b) => b[sortKey] - a[sortKey]);
    return ranked;
  });
}
