import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  AutoBetBookmaker,
  RecordAutoBetRunInput,
  SaveBookmakerCredentialInput,
  UpdateAutoBetSettingsInput,
  ExtensionToggleInput,
  type AutoBetRunView,
} from "@evobo/shared-types";
import { Prisma } from "@prisma/client";
import { autoBetSettingsView } from "./settings.js";
import { authGuard } from "../../middleware/authGuard.js";
import { autoBettingAccess, extensionKeyGuard, hashExtensionKey } from "../../middleware/extensionKeyGuard.js";
import { recordAuditLog } from "../../middleware/auditLog.js";
import { prisma } from "../../db/prisma.js";
import { open, seal, secretBoxEnabled } from "../../lib/secretBox.js";

/** "br****@hotmail.com" / "jo****" — enough to recognize the account, never
 * the full login: at most 2 characters shown, only 1 for a short (≤3) name,
 * none for a 1-character one. */
function maskUsername(username: string): string {
  const at = username.lastIndexOf("@");
  const local = at === -1 ? username : username.slice(0, at);
  const domain = at === -1 ? null : username.slice(at + 1);
  const shown = local.slice(0, local.length <= 1 ? 0 : local.length <= 3 ? 1 : 2);
  return `${shown}****${domain ? `@${domain}` : ""}`;
}

const ctx = (userId: string, bookmaker: string, field: "username" | "password") => `${userId}:${bookmaker}:${field}`;

/**
 * "Aposta automática" — per user (VIP Telegram access). The page (Supabase session)
 * saves/removes bookmaker logins and manages the extension key; the betting
 * extension (extension key) is the only caller that ever gets a login back
 * decrypted, and every such read is audit-logged.
 */
export async function autoBettingRoutes(app: FastifyInstance) {
  app.register(async (profile) => {
    profile.addHook("preHandler", authGuard);
    profile.addHook("preHandler", autoBettingAccess);

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
      await recordAuditLog({ actorId: userId, action: "bookmaker_credential.save", targetType: "bookmaker_credential", metadata: { bookmaker: bookmaker.data } });
      return reply.code(204).send();
    });

    profile.delete<{ Params: { bookmaker: string } }>("/credentials/:bookmaker", async (request, reply) => {
      const bookmaker = AutoBetBookmaker.safeParse(request.params.bookmaker);
      if (!bookmaker.success) return reply.code(400).send({ error: "unsupported_bookmaker" });
      const userId = request.authUser!.id;
      const { count } = await prisma.bookmakerCredential.deleteMany({ where: { userId, bookmaker: bookmaker.data } });
      if (count === 0) return reply.code(404).send({ error: "no_credentials" });
      await recordAuditLog({ actorId: userId, action: "bookmaker_credential.delete", targetType: "bookmaker_credential", metadata: { bookmaker: bookmaker.data } });
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

    profile.get("/settings", async (request) => autoBetSettingsView(request.authUser!.id));

    // Ligar grava enabledSince = agora: só tips que chegarem depois entram na
    // fila (nunca apostar em tip antiga ao religar).
    profile.put("/settings", async (request, reply) => {
      const parsed = UpdateAutoBetSettingsInput.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
      const userId = request.authUser!.id;
      const input = parsed.data;
      const current = await prisma.autoBetSettings.findUnique({ where: { userId } });
      const turningOn = input.enabled === true && !current?.enabled;
      const data = {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.placeReal !== undefined ? { placeReal: input.placeReal } : {}),
        ...(input.maxStakeReais !== undefined ? { maxStakeReais: input.maxStakeReais } : {}),
        ...(turningOn ? { enabledSince: new Date() } : {}),
      };
      await prisma.autoBetSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
      if (input.enabled !== undefined || input.placeReal !== undefined || input.maxStakeReais !== undefined) {
        await recordAuditLog({ actorId: userId, action: "auto_bet_settings.update", targetType: "auto_bet_settings", targetId: userId, metadata: input });
      }
      return autoBetSettingsView(userId);
    });

    // days: 1 = hoje (desde 00:00 em São Paulo), 7 / 30 = últimos N dias.
    profile.get<{ Querystring: { limit?: string; days?: string } }>("/runs", async (request, reply): Promise<AutoBetRunView[] | void> => {
      const limit = Math.min(200, Math.max(1, Math.trunc(Number(request.query.limit)) || 50));
      const days = request.query.days === undefined ? null : Number(request.query.days);
      if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 90)) return reply.code(400).send({ error: "invalid_days" });
      const since = days === 1 ? startOfTodaySaoPaulo() : days ? new Date(Date.now() - days * 86_400_000) : null;
      const rows = await prisma.autoBetRun.findMany({
        where: { userId: request.authUser!.id, ...(since ? { createdAt: { gte: since } } : {}) },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return rows.map(runView);
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

      let login: { username: string; password: string };
      try {
        login = {
          username: open(row.usernameEnc, ctx(userId, bookmaker.data, "username")),
          password: open(row.passwordEnc, ctx(userId, bookmaker.data, "password")),
        };
      } catch (err) {
        // Chave de criptografia trocada ou dado corrompido: o login tem que
        // ser cadastrado de novo no Evobo.
        request.log.error({ err, bookmaker: bookmaker.data }, "auto-betting: stored login failed to decrypt");
        return reply.code(409).send({ error: "credencial_invalida" });
      }
      await recordAuditLog({ actorId: userId, action: "bookmaker_credential.read_by_extension", targetType: "bookmaker_credential", metadata: { bookmaker: bookmaker.data } });
      return login;
    });

    // Status/limites pro popup (teste manual) — a fila (betting-queue) manda
    // o mesmo junto das tips.
    extension.get("/extension/settings", async (request) => autoBetSettingsView(request.authUser!.id));

    // O popup só liga/desliga; modo, teto e logins ficam na página do Evobo.
    extension.put("/extension/settings", async (request, reply) => {
      const parsed = ExtensionToggleInput.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
      const userId = request.authUser!.id;
      const current = await prisma.autoBetSettings.findUnique({ where: { userId } });
      const data = { enabled: parsed.data.enabled, ...(parsed.data.enabled && !current?.enabled ? { enabledSince: new Date() } : {}) };
      await prisma.autoBetSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
      await recordAuditLog({ actorId: userId, action: "auto_bet_settings.update", targetType: "auto_bet_settings", targetId: userId, metadata: { enabled: parsed.data.enabled, via: "extension" } });
      return autoBetSettingsView(userId);
    });

    // Histórico: uma linha por tip processada (ou teste manual). Relatório
    // grande demais é descartado, o resumo fica.
    extension.post("/extension/runs", async (request, reply) => {
      const parsed = RecordAutoBetRunInput.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
      const input = parsed.data;
      // meta vai dentro do report (sem coluna própria) — runView tira de lá.
      const withMeta = input.meta ? { ...(typeof input.report === "object" && input.report ? input.report : {}), meta: input.meta } : input.report;
      const reportJson = withMeta === undefined ? undefined : JSON.stringify(withMeta);
      const report =
        reportJson === undefined ? Prisma.DbNull : reportJson.length > MAX_REPORT_CHARS ? { descartado: "relatorio_grande_demais", tamanho: reportJson.length, meta: input.meta ?? null } : (withMeta as Prisma.InputJsonValue);
      const row = await prisma.autoBetRun.create({
        data: {
          userId: request.authUser!.id,
          bookmaker: input.bookmaker,
          taskKey: input.taskKey,
          betUrl: input.betUrl ?? null,
          title: input.title ?? null,
          status: input.status,
          summary: input.summary,
          dryRun: input.dryRun,
          report,
        },
      });
      return reply.code(201).send({ id: row.id });
    });
  });
}

const MAX_REPORT_CHARS = 100_000;

/** 00:00 de hoje em São Paulo (UTC-3 fixo desde 2019), como instante UTC. */
function startOfTodaySaoPaulo(): Date {
  const sp = new Date(Date.now() - 3 * 3_600_000);
  return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate(), 3));
}

function runView(r: {
  id: string;
  bookmaker: string;
  taskKey: string;
  betUrl: string | null;
  title: string | null;
  status: string;
  summary: string;
  dryRun: boolean;
  report: Prisma.JsonValue;
  createdAt: Date;
}): AutoBetRunView {
  const meta = (r.report && typeof r.report === "object" && !Array.isArray(r.report) ? (r.report as { meta?: Record<string, unknown> }).meta : null) ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: r.id,
    bookmaker: r.bookmaker as AutoBetRunView["bookmaker"],
    taskKey: r.taskKey,
    betUrl: r.betUrl,
    title: r.title,
    status: r.status as AutoBetRunView["status"],
    summary: r.summary,
    dryRun: r.dryRun,
    groupName: str(meta.groupName),
    tipOdd: num(meta.tipOdd),
    realOdd: num(meta.realOdd),
    stakeReais: num(meta.stakeReais),
    reason: str(meta.reason),
    report: r.report,
    createdAt: r.createdAt.toISOString(),
  };
}
