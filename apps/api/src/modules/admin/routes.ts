import type { FastifyInstance } from "fastify";
import { authGuard } from "../../middleware/authGuard.js";
import { roleGuard } from "../../middleware/roleGuard.js";
import { prisma } from "../../db/prisma.js";
import { listCuratedMarketGroups } from "../robot-signals/routes.js";

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", roleGuard("admin"));

  // VIP revenue is intentionally not shown here — Grupo VIP/Checkout hasn't
  // shipped yet (deprioritized by the user), so there is no real payments
  // data to report; showing a number would be fabricating it.
  app.get("/overview", async () => {
    const [tipstersCount, usersCount] = await Promise.all([
      prisma.user.count({
        where: { role: { name: { in: ["tipster", "tipster_verified"] } }, isActive: true },
      }),
      prisma.user.count({ where: { isActive: true } }),
    ]);

    return { tipstersCount, usersCount };
  });

  /**
   * "Histórico do Robô" — per-market "odd indicada" editor. See
   * RobotMarketOdd in schema.prisma and fetchMarketOdds in
   * robot-signals/routes.ts for what this actually drives (the
   * "Lucro com odd indicada" stat on the market detail page).
   */
  app.get("/robot-market-odds", async (request) => {
    const [groups, oddsRows] = await Promise.all([
      listCuratedMarketGroups(request.log),
      prisma.robotMarketOdd.findMany(),
    ]);
    const oddsByGroupKey = new Map(oddsRows.map((r) => [r.groupKey, Number(r.indicatedOdd)]));
    return groups
      .map((g) => ({ ...g, indicatedOdd: oddsByGroupKey.get(g.groupKey) ?? null }))
      .sort((a, b) => a.market.localeCompare(b.market));
  });

  app.patch<{ Params: { groupKey: string }; Body: { indicatedOdd: number | null } }>(
    "/robot-market-odds/:groupKey",
    async (request) => {
      const groupKey = decodeURIComponent(request.params.groupKey);
      const { indicatedOdd } = request.body;
      if (indicatedOdd === null) {
        await prisma.robotMarketOdd.deleteMany({ where: { groupKey } });
        return { groupKey, indicatedOdd: null };
      }
      const row = await prisma.robotMarketOdd.upsert({
        where: { groupKey },
        create: { groupKey, indicatedOdd },
        update: { indicatedOdd },
      });
      return { groupKey, indicatedOdd: Number(row.indicatedOdd) };
    },
  );
}
