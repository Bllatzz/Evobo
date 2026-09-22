import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db/prisma.js";

export const hashExtensionKey = (key: string) => createHash("sha256").update(key).digest("hex");

/**
 * Auth for the betting extension (apps/betting-extension): `x-extension-key`
 * is looked up by its SHA-256 (see ExtensionKey) and resolves to its owner,
 * who must still be an active admin on every request — demoting or
 * suspending the user cuts the extension off without touching the key.
 * Sets request.authUser like authGuard does.
 */
export async function extensionKeyGuard(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers["x-extension-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key) return reply.code(401).send({ error: "missing_extension_key" });

  const row = await prisma.extensionKey.findUnique({
    where: { keyHash: hashExtensionKey(key) },
    include: { user: { include: { role: true } } },
  });
  if (!row || !row.user.isActive || row.user.role.name !== "admin") {
    return reply.code(401).send({ error: "invalid_extension_key" });
  }

  request.authUser = { id: row.user.id, roleId: row.user.roleId, roleName: row.user.role.name };
  // Best-effort "last seen" for the profile card; never blocks the request.
  void prisma.extensionKey.update({ where: { userId: row.userId }, data: { lastUsedAt: new Date() } }).catch(() => {});
}

/** Must run after authGuard. "Aposta automática" is admin-only for now. */
export async function adminOnly(request: FastifyRequest, reply: FastifyReply) {
  if (request.authUser?.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
}
