import type { FastifyInstance } from "fastify";
import { authGuard } from "../../middleware/authGuard.js";
import { prisma } from "../../db/prisma.js";

/**
 * Signup/login/logout/password-recovery happen client-side via supabase-js
 * against Supabase Auth directly — that's the whole point of choosing it
 * (session storage, refresh rotation, OAuth already handled). Aggressive
 * rate limiting on those endpoints is configured on the Supabase Auth
 * server (supabase/config.toml [auth.rate_limit]), not here, since those
 * requests never reach this backend.
 *
 * This module only covers what has to run backend-side: resolving the
 * caller's profile + role + accessible screens, which the frontend route
 * guard and every other module's roleGuard both depend on.
 */
export async function authRoutes(app: FastifyInstance) {
  app.get("/me", { preHandler: authGuard }, async (request) => {
    const { id } = request.authUser!;

    const [user, access, activeVipSubscriptions] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id }, include: { role: true } }),
      prisma.roleScreenAccess.findMany({ where: { roleId: request.authUser!.roleId } }),
      prisma.vipSubscription.count({
        where: { userId: id, status: "active", expiresAt: { gt: new Date() } },
      }),
    ]);
    const hasActiveVip = activeVipSubscriptions > 0;

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      favoriteSports: user.favoriteSports,
      role: user.role.name,
      verifiedAt: user.verifiedAt,
      hasActiveVip,
      accessibleScreens: access
        .filter((a) => a.tier === "free" || hasActiveVip)
        .map((a) => a.screenKey),
    };
  });
}
