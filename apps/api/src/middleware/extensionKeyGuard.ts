import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db/prisma.js";
import { roleGuard } from "./roleGuard.js";

export const hashExtensionKey = (key: string) => createHash("sha256").update(key).digest("hex");

/**
 * Auth for the betting extension (apps/betting-extension): `x-extension-key`
 * is looked up by its SHA-256 (see ExtensionKey) and resolves to its owner,
 * who must still be active and still have the "VIP Telegram" screen
 * (telegram_banca — the tips the extension bets on) on every request:
 * suspending the user or taking the screen away cuts the extension off
 * without touching the key. Sets request.authUser like authGuard does.
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
 * per user, for whoever can see the tips it bets on (VIP Telegram). */
export const autoBettingAccess = roleGuard("telegram_banca");
