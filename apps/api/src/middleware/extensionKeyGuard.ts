import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db/prisma.js";

export const hashExtensionKey = (key: string) => createHash("sha256").update(key).digest("hex");

/**
 * Auth for the betting extension (apps/betting-extension): `x-extension-key`
 * is looked up by its SHA-256 (see ExtensionKey) and resolves to its owner,
 * who must still be active and allowed into "Aposta automática" (admin
 * for now, see autoBettingAccess) on every request: suspending or
 * demoting the user cuts the extension off without touching the key. Sets request.authUser like authGuard does.
 */
export async function extensionKeyGuard(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers["x-extension-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key) return reply.code(401).send({ error: "missing_extension_key" });

  const row = await prisma.extensionKey.findUnique({
    where: { keyHash: hashExtensionKey(key) },
    include: { user: { include: { role: true } } },
  });
  if (!row || !row.user.isActive) {
    return reply.code(401).send({ error: "invalid_extension_key" });
  }

  request.authUser = { id: row.user.id, roleId: row.user.roleId, roleName: row.user.role.name };
  await autoBettingAccess(request, reply);
  if (reply.sent) return;
  // Best-effort "last seen" for the profile card ("extensão conectada");
  // never blocks the request. The extension polls every few seconds, so
  // write at most every 30s.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 30_000) {
    void prisma.extensionKey.update({ where: { userId: row.userId }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
}

/** Must run after authGuard (or with authUser set). "Aposta automática" is
 * per user by design (settings, logins, history keyed by userId), but for
 * now only admins get in (pedido do usuário, 2026-09-24). Opening it up
 * later = swap this for roleGuard("telegram_banca"). */
export async function autoBettingAccess(request: FastifyRequest, reply: FastifyReply) {
  if (request.authUser?.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
}
