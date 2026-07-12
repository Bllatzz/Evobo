import type { FastifyInstance } from "fastify";
import {
  AssignRoleInput,
  CreateRoleInput,
  ScreenTier,
  UpdateRoleInput,
  UpdateRoleScreenAccessInput,
} from "@evobo/shared-types";
import { authGuard } from "../../middleware/authGuard.js";
import { roleGuard } from "../../middleware/roleGuard.js";
import { recordAuditLog } from "../../middleware/auditLog.js";
import { prisma, withPrivilegedWrite } from "../../db/prisma.js";

/**
 * Gestão de Roles — the Admin sub-screen this backs isn't in the original
 * design (spec calls for it explicitly, styled like the rest of Admin).
 * Every mutating endpoint here is behind admin_roles and writes an
 * audit_logs row, since role/permission changes are exactly the kind of
 * sensitive action the security spec calls out by name.
 */
export async function rolesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", roleGuard("admin_roles"));

  app.get("/", async () => {
    const roles = await prisma.role.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { users: true } } },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      userCount: r._count.users,
    }));
  });

  app.post("/", async (request, reply) => {
    const parsed = CreateRoleInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }

    const existing = await prisma.role.findUnique({ where: { name: parsed.data.name } });
    if (existing) {
      return reply.code(409).send({ error: "role_name_taken" });
    }

    const role = await prisma.role.create({
      data: { name: parsed.data.name, description: parsed.data.description, isSystem: false },
    });

    await recordAuditLog({
      actorId: request.authUser!.id,
      action: "role.create",
      targetType: "role",
      targetId: role.id,
      metadata: { name: role.name },
    });

    return reply.code(201).send(role);
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const role = await prisma.role.findUnique({
      where: { id: request.params.id },
      include: { screenAccess: true },
    });
    if (!role) return reply.code(404).send({ error: "not_found" });

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      screens: role.screenAccess.map((s) => s.screenKey),
      screensByTier: {
        free: role.screenAccess.filter((s) => s.tier === "free").map((s) => s.screenKey),
        vip: role.screenAccess.filter((s) => s.tier === "vip").map((s) => s.screenKey),
      },
    };
  });

  app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const parsed = UpdateRoleInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }

    const role = await prisma.role.update({
      where: { id: request.params.id },
      data: { description: parsed.data.description },
    });

    await recordAuditLog({
      actorId: request.authUser!.id,
      action: "role.update",
      targetType: "role",
      targetId: role.id,
      metadata: parsed.data,
    });

    return role;
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const role = await prisma.role.findUnique({
      where: { id: request.params.id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) return reply.code(404).send({ error: "not_found" });
    if (role.isSystem) {
      return reply.code(403).send({ error: "cannot_delete_system_role" });
    }
    if (role._count.users > 0) {
      return reply.code(409).send({ error: "role_has_users", userCount: role._count.users });
    }

    await prisma.role.delete({ where: { id: role.id } });

    await recordAuditLog({
      actorId: request.authUser!.id,
      action: "role.delete",
      targetType: "role",
      targetId: role.id,
      metadata: { name: role.name },
    });

    return reply.code(204).send();
  });

  // Full replace of a role's screen checklist for one tier — admin can edit
  // this even for system roles (only rename/delete is blocked for those, per
  // spec). ?tier defaults to "free" so existing callers (Gestão de Roles,
  // which has no tier concept) keep working unchanged.
  app.put<{ Params: { id: string }; Querystring: { tier?: string } }>(
    "/:id/screen-access",
    async (request, reply) => {
      const parsed = UpdateRoleScreenAccessInput.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const tierParsed = ScreenTier.safeParse(request.query.tier ?? "free");
      if (!tierParsed.success) {
        return reply.code(400).send({ error: "invalid_tier" });
      }
      const tier = tierParsed.data;
      const screens = [...new Set(parsed.data.screens)];

      const role = await prisma.role.findUnique({ where: { id: request.params.id } });
      if (!role) return reply.code(404).send({ error: "not_found" });

      // A screenKey can only hold one tier at a time (it's the primary key
      // with roleId) — claiming it for this tier evicts any row the other
      // tier currently holds for the same screen, then replaces this tier's
      // whole set.
      const otherTier: ScreenTier = tier === "free" ? "vip" : "free";
      await prisma.$transaction([
        prisma.roleScreenAccess.deleteMany({
          where: { roleId: role.id, tier: otherTier, screenKey: { in: screens } },
        }),
        prisma.roleScreenAccess.deleteMany({ where: { roleId: role.id, tier } }),
        prisma.roleScreenAccess.createMany({
          data: screens.map((screenKey) => ({ roleId: role.id, screenKey, tier })),
        }),
      ]);

      await recordAuditLog({
        actorId: request.authUser!.id,
        action: "role.screen_access.update",
        targetType: "role",
        targetId: role.id,
        metadata: { tier, screens },
      });

      return { id: role.id, tier, screens };
    },
  );

  app.get<{ Querystring: { q?: string } }>("/users/search", async (request) => {
    const q = request.query.q?.trim();
    if (!q) return [];

    return prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 10,
      include: { role: true },
    });
  });

  app.post("/assign", async (request, reply) => {
    const parsed = AssignRoleInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }

    const [user, role] = await Promise.all([
      prisma.user.findUnique({ where: { id: parsed.data.userId } }),
      prisma.role.findUnique({ where: { id: parsed.data.roleId } }),
    ]);
    if (!user) return reply.code(404).send({ error: "user_not_found" });
    if (!role) return reply.code(404).send({ error: "role_not_found" });

    const updated = await withPrivilegedWrite("user", (tx) =>
      tx.user.update({ where: { id: user.id }, data: { roleId: role.id } }),
    );

    await recordAuditLog({
      actorId: request.authUser!.id,
      action: "user.role_assigned",
      targetType: "user",
      targetId: user.id,
      metadata: { fromRoleId: user.roleId, toRoleId: role.id, toRoleName: role.name },
    });

    return updated;
  });
}
