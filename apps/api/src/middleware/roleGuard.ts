import type { FastifyReply, FastifyRequest } from "fastify";
import type { ScreenKey } from "@evobo/shared-types";
import { prisma } from "../db/prisma.js";

/**
 * Backend half of the two-layer authorization check — must run after
 * authGuard. Re-derives access from role_screen_access on every request;
 * never trusts a screen flag the client sent.
 */
export function roleGuard(screen: ScreenKey) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.authUser) {
      return reply.code(401).send({ error: "unauthenticated" });
    }

    // admin is a hard-coded superuser: it sees every screen regardless of
    // what's toggled in Admin → Telas, so new screens work for admin the
    // moment they ship instead of needing a manual grant first.
    if (request.authUser.roleName === "admin") return;

    const access = await prisma.roleScreenAccess.findUnique({
      where: {
        roleId_screenKey: { roleId: request.authUser.roleId, screenKey: screen },
      },
    });

    if (!access) {
      return reply.code(403).send({ error: "forbidden", screen });
    }

    if (access.tier === "vip") {
      const activeVipSubscriptions = await prisma.vipSubscription.count({
        where: { userId: request.authUser.id, status: "active", expiresAt: { gt: new Date() } },
      });
      if (activeVipSubscriptions === 0) {
        return reply.code(403).send({ error: "forbidden", screen });
      }
    }
  };
}
