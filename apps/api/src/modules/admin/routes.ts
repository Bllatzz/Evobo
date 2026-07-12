import type { FastifyInstance } from "fastify";
import { authGuard } from "../../middleware/authGuard.js";
import { roleGuard } from "../../middleware/roleGuard.js";
import { prisma } from "../../db/prisma.js";

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
}
