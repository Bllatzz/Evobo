import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import fastifyExpress from "@fastify/express";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { Prisma } from "@prisma/client";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";

import { authRoutes } from "./modules/auth/routes.js";
import { usersRoutes } from "./modules/users/routes.js";
import { tipsRoutes } from "./modules/tips/routes.js";
import { gamesRoutes } from "./modules/games/routes.js";
import { gamesLiveRoutes } from "./modules/games-live/routes.js";
import { vipRoutes } from "./modules/vip/routes.js";
import { paymentsRoutes } from "./modules/payments/routes.js";
import { followsRoutes } from "./modules/follows/routes.js";
import { favoritesRoutes } from "./modules/favorites/routes.js";
import { bettingQueueRoutes } from "./modules/betting-queue/routes.js";
import { autoBettingRoutes } from "./modules/auto-betting/routes.js";
import { rankingRoutes } from "./modules/ranking/routes.js";
import { commentsRoutes } from "./modules/comments/routes.js";
import { notificationsRoutes } from "./modules/notifications/routes.js";
import { rolesRoutes } from "./modules/roles/routes.js";
import { aiAnalysisRoutes } from "./modules/ai-analysis/routes.js";
import { robotSignalsRoutes } from "./modules/robot-signals/routes.js";
import { telegramTipsRoutes } from "./modules/telegram-tips/routes.js";
import { evPlusRoutes } from "./modules/ev-plus/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { searchRoutes } from "./modules/search/routes.js";

const app = Fastify({
  // The API sits behind exactly one proxy hop (Fly's edge). Without this,
  // request.ip is the proxy's address, so the rate limiter below puts every
  // client in a single bucket. `1` (not `true`) trusts only that last hop, so
  // a client can't dodge the limit by sending its own X-Forwarded-For.
  trustProxy: 1,
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    // Never log Authorization headers, tokens, or payment/proof payloads.
    redact: ["req.headers.authorization", "req.headers.cookie", "req.headers[\"x-api-key\"]", "req.headers[\"x-extension-key\"]"],
    serializers: {
      // O EventSource do robotip (/robotip/api/alerts/events) só consegue mandar
      // a chave por querystring (?api_key=) — tira ela da URL antes de logar.
      req(req) {
        return { method: req.method, url: req.url.replace(/([?&]api_key=)[^&]*/gi, "$1[REDACTED]"), hostname: req.hostname, remoteAddress: req.ip };
      },
    },
  },
});

await app.register(helmet);
// @fastify/cors defaults `methods` to "GET,HEAD,POST" only (unlike the
// Express `cors` package) — every PATCH/PUT/DELETE route (profile edit,
// untake tip, unfollow, admin role changes, ...) was silently CORS-blocked
// from the browser until this was made explicit.
await app.register(cors, {
  // This hook runs before requests reach @fastify/express, so it also gates
  // /robotip — robotip's frontend (a different Vercel origin) needs to be
  // allowed here too, not just the mounted app's own cors() middleware.
  origin: [env.CORS_ORIGIN, "https://robotip-analyzer.vercel.app"],
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"],
});
// Logged-in pages fire ~11 requests per load (Meu perfil), so 100/min tripped
// 429s after a handful of reloads. Still keyed by IP, not by user: this hook
// runs before authGuard, so the token isn't verified yet — keying on its
// unverified `sub` would let forged tokens mint fresh buckets. A bearer header
// only raises the per-IP ceiling.
await app.register(rateLimit, {
  global: true,
  max: (request) => (request.headers.authorization?.startsWith("Bearer ") ? 300 : 100),
  timeWindow: "1 minute",
});

// Prisma errors carry internal details (column/table/query names) in
// `.message` — never forward those to the client, only to the server log.
app.setErrorHandler((error: FastifyError, request, reply) => {
  request.log.error({ err: error }, "unhandled request error");

  if (error.validation) {
    return reply.code(400).send({ error: "invalid_input" });
  }

  // Bad client input that got past the route's own checks (malformed uuid,
  // Invalid Date, NaN, unknown enum value) is the caller's mistake, not ours.
  if (
    error instanceof Prisma.PrismaClientValidationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2023")
  ) {
    return reply.code(400).send({ error: "invalid_input" });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return reply.code(404).send({ error: "not_found" });
    if (error.code === "P2002" || error.code === "P2003") {
      return reply.code(409).send({ error: "conflict" });
    }
  }

  const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
  return reply.code(statusCode).send({ error: statusCode < 500 ? error.message : "internal_error" });
});

if (!env.OWNER_USER_ID) {
  app.log.warn("OWNER_USER_ID is not set — no admin can be demoted or suspended by another admin until it is");
}

app.get("/health", async () => ({ status: "ok" }));

await app.register(authRoutes, { prefix: "/auth" });
await app.register(usersRoutes, { prefix: "/users" });
await app.register(tipsRoutes, { prefix: "/tips" });
await app.register(gamesRoutes, { prefix: "/games" });
await app.register(gamesLiveRoutes, { prefix: "/games-live" });
await app.register(vipRoutes, { prefix: "/vip" });
await app.register(paymentsRoutes, { prefix: "/payments" });
await app.register(followsRoutes, { prefix: "/follows" });
await app.register(favoritesRoutes, { prefix: "/favorites" });
await app.register(rankingRoutes, { prefix: "/ranking" });
await app.register(commentsRoutes, { prefix: "/comments" });
await app.register(notificationsRoutes, { prefix: "/notifications" });
await app.register(rolesRoutes, { prefix: "/roles" });
await app.register(aiAnalysisRoutes, { prefix: "/ai-analysis" });
await app.register(robotSignalsRoutes, { prefix: "/robot-signals" });
await app.register(telegramTipsRoutes, { prefix: "/telegram-tips" });
await app.register(evPlusRoutes, { prefix: "/ev-plus" });
await app.register(adminRoutes, { prefix: "/admin" });
await app.register(searchRoutes, { prefix: "/search" });
await app.register(bettingQueueRoutes, { prefix: "/betting-queue" });
await app.register(autoBettingRoutes, { prefix: "/auto-betting" });

// CornerIQ (robotip-analyzer) migrado do app Fly separado — Express legado
// montado como está via @fastify/express, isolado sob /robotip pra não
// arriscar nada nas rotas nativas do evobo acima. Ver
// packages/robotip-legacy — env vars com prefixo ROBOTIP_ pra não colidir
// com os secrets de Telegram/DB do evobo (sessões distintas, mesma conta).
await app.register(fastifyExpress);
const robotipLegacy = await import("@evobo/robotip-legacy");
app.use("/robotip", robotipLegacy.createApp());

app
  // "::" binds dual-stack (IPv4 + IPv6) — needed because Windows, under
  // WSL2 mirrored networking, resolves "localhost" to [::1] first; a
  // v4-only "0.0.0.0" bind gets that connection RST instead of accepted,
  // which Chrome surfaces as net::ERR_CONNECTION_RESET on /auth/me.
  .listen({ port: env.PORT, host: "::" })
  .then(() => app.log.info(`evobo api listening on :${env.PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

// Fly stops the machine with a signal on every deploy. Without a handler the
// process dies instantly and in-flight requests get cut off; this lets them
// finish, closes the DB pool, then exits. The timer is a hard stop so a stuck
// connection can never hold up the deploy — kept under Fly's default 5s
// kill_timeout (fly.toml doesn't override it), after which Fly SIGKILLs anyway.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  setTimeout(() => process.exit(1), 4_000).unref();
  try {
    await app.close();
    await prisma.$disconnect();
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Telegram listener + OCR queue, same process/machine as the API — see
// apps/worker/src/index.ts and apps/api/Dockerfile for why. Only set in
// production (TELEGRAM_API_ID absent locally), so `npm run dev:api` never
// tries to connect to Telegram.
if (process.env.TELEGRAM_API_ID) {
  // A failure while LOADING the worker (e.g. a missing env var it validates on
  // import) must not take the whole API down with it — a crash here would
  // restart-loop the machine over something that only affects Telegram.
  try {
    const { startTelegramWorker } = await import("@evobo/worker");
    startTelegramWorker().catch((err) => app.log.error({ err }, "telegram worker crashed"));
  } catch (err) {
    app.log.error({ err }, "failed to load the telegram worker — API keeps running without it");
  }
}

// Os 2 auto-checkers de fundo (corner/home-win) só leem alertas pendentes do
// Postgres e chamam a StatsFeed pública do robotip.com.br — não tocam no
// Telegram, então não têm o risco de colisão de sessão do listener abaixo.
// Gate própria (ROBOTIP_DATABASE_URL) pra poder ligá-los antes da sessão do
// Telegram estar pronta pra migrar.
if (process.env.ROBOTIP_DATABASE_URL) {
  robotipLegacy.startCornerAutoChecker();
  robotipLegacy.startHomeWinAutoChecker();
}

// Listener de Telegram do robotip (sessão PRÓPRIA, distinta da usada acima
// por @evobo/worker). Gate separada do resto: como a MESMA ROBOTIP_TELEGRAM_
// SESSION ainda está conectada a partir do robotip-analyzer (Fly app antigo,
// ainda rodando), ligar aqui ao mesmo tempo colidiria (AUTH_KEY_DUPLICATED) e
// arrisca duplicar o processamento de alertas / disparo de auto-aposta. Só
// habilitar quando o robotip-analyzer for desligado (corte deliberado).
if (process.env.ROBOTIP_TELEGRAM_API_ID) {
  robotipLegacy
    .startTelegramListener()
    .catch((err) => app.log.error({ err }, "robotip telegram listener crashed"));
}
