import type { FastifyReply, FastifyRequest } from "fastify";
import { supabaseAdmin } from "../db/supabase.js";
import { prisma } from "../db/prisma.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: { id: string; roleId: string; roleName: string };
  }
}

/**
 * Verifies the bearer token against Supabase Auth (network round-trip, but
 * correct regardless of whether the project signs JWTs HS256 or ES256) and
 * loads the matching public.users row for role checks. Every route that
 * touches non-public data must run this — the frontend route guard is a
 * convenience, not a security boundary.
 */
export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    return reply.code(401).send({ error: "missing_token" });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    return reply.code(401).send({ error: "invalid_token" });
  }

  const profile = await prisma.user.findUnique({
    where: { id: data.user.id },
    include: { role: true },
  });

  if (!profile || !profile.isActive) {
    return reply.code(401).send({ error: "user_inactive" });
  }

  request.authUser = { id: profile.id, roleId: profile.roleId, roleName: profile.role.name };
}

/**
 * Same resolution as authGuard, but for endpoints that serve public data
 * with viewer-dependent extras (e.g. "did I take this tip") — never
 * rejects, just leaves request.authUser unset on any failure.
 */
export async function optionalAuthGuard(request: FastifyRequest) {
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (!token) return;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return;

  const profile = await prisma.user.findUnique({
    where: { id: data.user.id },
    include: { role: true },
  });
  if (!profile || !profile.isActive) return;

  request.authUser = { id: profile.id, roleId: profile.roleId, roleName: profile.role.name };
}
