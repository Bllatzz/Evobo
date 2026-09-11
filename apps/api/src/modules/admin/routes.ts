import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { authGuard } from "../../middleware/authGuard.js";
import { roleGuard } from "../../middleware/roleGuard.js";
import { recordAuditLog } from "../../middleware/auditLog.js";
import { prisma, withPrivilegedWrite } from "../../db/prisma.js";
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

  // ── Usuários ─────────────────────────────────────────────────────────
  app.get<{ Querystring: { page?: string; limit?: string; q?: string } }>("/users", async (request) => {
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 30));
    const q = request.query.q?.trim();
    const where: Prisma.UserWhereInput = q
      ? { OR: [{ username: { contains: q, mode: "insensitive" } }, { displayName: { contains: q, mode: "insensitive" } }] }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { role: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      data: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        role: { id: u.role.id, name: u.role.name },
        isActive: u.isActive,
        verifiedAt: u.verifiedAt,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // Suspend/reactivate — role changes stay on POST /roles/assign (admin_roles
  // screen), this only ever touches is_active. Goes through
  // withPrivilegedWrite since account status is guarded by
  // prevent_users_privileged_self_update() (see rls_trigger_seed migration).
  app.patch<{ Params: { id: string }; Body: { isActive?: boolean } }>("/users/:id", async (request, reply) => {
    const { isActive } = request.body;
    if (typeof isActive !== "boolean") {
      return reply.code(400).send({ error: "invalid_input" });
    }
    if (request.params.id === request.authUser!.id && !isActive) {
      return reply.code(400).send({ error: "cannot_deactivate_self" });
    }

    const target = await prisma.user.findUnique({ where: { id: request.params.id } });
    if (!target) return reply.code(404).send({ error: "not_found" });

    const updated = await withPrivilegedWrite("user", (tx) =>
      tx.user.update({ where: { id: request.params.id }, data: { isActive } }),
    );

    await recordAuditLog({
      actorId: request.authUser!.id,
      action: isActive ? "user.reactivated" : "user.deactivated",
      targetType: "user",
      targetId: updated.id,
      metadata: { username: updated.username },
    });

    return { id: updated.id, isActive: updated.isActive };
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
