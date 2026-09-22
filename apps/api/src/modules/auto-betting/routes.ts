import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { AutoBetBookmaker, SaveBookmakerCredentialInput } from "@evobo/shared-types";
import { authGuard } from "../../middleware/authGuard.js";
import { adminOnly, extensionKeyGuard, hashExtensionKey } from "../../middleware/extensionKeyGuard.js";
import { recordAuditLog } from "../../middleware/auditLog.js";
import { prisma } from "../../db/prisma.js";
import { open, seal, secretBoxEnabled } from "../../lib/secretBox.js";

/** "b****@hotmail.com" / "jo****" — enough to recognize the account, never the full login. */
function maskUsername(username: string): string {
  const [local, domain] = username.split("@") as [string, string | undefined];
  const shown = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${shown}****${domain ? `@${domain}` : ""}`;
}

const ctx = (userId: string, bookmaker: string, field: "username" | "password") => `${userId}:${bookmaker}:${field}`;

/**
 * "Aposta automática" — admin-only for now. The profile (Supabase session)
 * saves/removes bookmaker logins and manages the extension key; the betting
 * extension (extension key) is the only caller that ever gets a login back
 * decrypted, and every such read is audit-logged.
 */
export async function autoBettingRoutes(app: FastifyInstance) {
  app.register(async (profile) => {
    profile.addHook("preHandler", authGuard);
    profile.addHook("preHandler", adminOnly);

    profile.get("/credentials", async (request) => {
      const rows = await prisma.bookmakerCredential.findMany({
        where: { userId: request.authUser!.id },
        select: { bookmaker: true, usernameHint: true, updatedAt: true },
        orderBy: { bookmaker: "asc" },
      });
      return { enabled: secretBoxEnabled(), credentials: rows };
    });

    profile.put<{ Params: { bookmaker: string } }>("/credentials/:bookmaker", async (request, reply) => {
      const bookmaker = AutoBetBookmaker.safeParse(request.params.bookmaker);
      if (!bookmaker.success) return reply.code(400).send({ error: "unsupported_bookmaker" });
      const parsed = SaveBookmakerCredentialInput.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
      if (!secretBoxEnabled()) return reply.code(503).send({ error: "encryption_not_configured" });

      const userId = request.authUser!.id;
      const { username, password } = parsed.data;
      const data = {
        usernameEnc: seal(username, ctx(userId, bookmaker.data, "username")),
        passwordEnc: seal(password, ctx(userId, bookmaker.data, "password")),
        usernameHint: maskUsername(username),
      };
      await prisma.bookmakerCredential.upsert({
        where: { userId_bookmaker: { userId, bookmaker: bookmaker.data } },
        create: { userId, bookmaker: bookmaker.data, ...data },
        update: data,
      });
      await recordAuditLog({ actorId: userId, action: "bookmaker_credential.save", targetType: "bookmaker_credential", targetId: bookmaker.data });
      return reply.code(204).send();
    });

    profile.delete<{ Params: { bookmaker: string } }>("/credentials/:bookmaker", async (request, reply) => {
      const userId = request.authUser!.id;
      await prisma.bookmakerCredential.deleteMany({ where: { userId, bookmaker: request.params.bookmaker } });
      await recordAuditLog({ actorId: userId, action: "bookmaker_credential.delete", targetType: "bookmaker_credential", targetId: request.params.bookmaker });
      return reply.code(204).send();
    });

    profile.get("/extension-key", async (request) => {
      const row = await prisma.extensionKey.findUnique({
        where: { userId: request.authUser!.id },
        select: { createdAt: true, lastUsedAt: true },
      });
      return { key: row };
    });

    // Generating a new key replaces (and so revokes) the previous one. The
    // plain key is returned exactly once — only its hash is stored.
    profile.post("/extension-key", async (request) => {
      const userId = request.authUser!.id;
      const key = `evx_${randomBytes(32).toString("base64url")}`;
      await prisma.extensionKey.upsert({
        where: { userId },
        create: { userId, keyHash: hashExtensionKey(key) },
        update: { keyHash: hashExtensionKey(key), createdAt: new Date(), lastUsedAt: null },
      });
      await recordAuditLog({ actorId: userId, action: "extension_key.create", targetType: "extension_key", targetId: userId });
      return { key };
    });

    profile.delete("/extension-key", async (request, reply) => {
      const userId = request.authUser!.id;
      await prisma.extensionKey.deleteMany({ where: { userId } });
      await recordAuditLog({ actorId: userId, action: "extension_key.revoke", targetType: "extension_key", targetId: userId });
      return reply.code(204).send();
    });
  });

  // The extension's side: its own owner's login, decrypted, to type into the
  // bookmaker's login form.
  app.register(async (extension) => {
    extension.addHook("preHandler", extensionKeyGuard);

    extension.get<{ Params: { bookmaker: string } }>("/extension/credentials/:bookmaker", async (request, reply) => {
      const bookmaker = AutoBetBookmaker.safeParse(request.params.bookmaker);
      if (!bookmaker.success) return reply.code(400).send({ error: "unsupported_bookmaker" });
      if (!secretBoxEnabled()) return reply.code(503).send({ error: "encryption_not_configured" });

      const userId = request.authUser!.id;
      const row = await prisma.bookmakerCredential.findUnique({
        where: { userId_bookmaker: { userId, bookmaker: bookmaker.data } },
      });
      if (!row) return reply.code(404).send({ error: "no_credentials" });

      await recordAuditLog({ actorId: userId, action: "bookmaker_credential.read_by_extension", targetType: "bookmaker_credential", targetId: bookmaker.data });
      return {
        username: open(row.usernameEnc, ctx(userId, bookmaker.data, "username")),
        password: open(row.passwordEnc, ctx(userId, bookmaker.data, "password")),
      };
    });
  });
}
