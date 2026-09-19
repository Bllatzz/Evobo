import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import fastifyExpress from "@fastify/express";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { Prisma } from "@prisma/client";
import { env } from "./config/env.js";

import { authRoutes } from "./modules/auth/routes.js";
import { usersRoutes } from "./modules/users/routes.js";
import { tipsRoutes } from "./modules/tips/routes.js";
import { gamesRoutes } from "./modules/games/routes.js";
import { gamesLiveRoutes } from "./modules/games-live/routes.js";
import { vipRoutes } from "./modules/vip/routes.js";
import { paymentsRoutes } from "./modules/payments/routes.js";
import { followsRoutes } from "./modules/follows/routes.js";
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
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    // Never log Authorization headers, tokens, or payment/proof payloads.
    redact: ["req.headers.authorization", "req.headers.cookie"],
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
await app.register(rateLimit, { global: true, max: 100, timeWindow: "1 minute" });

// Prisma errors carry internal details (column/table/query names) in
// `.message` — never forward those to the client, only to the server log.
app.setErrorHandler((error: FastifyError, request, reply) => {
  request.log.error({ err: error }, "unhandled request error");

  if (error.validation) {
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

app.get("/health", async () => ({ status: "ok" }));

await app.register(authRoutes, { prefix: "/auth" });
await app.register(usersRoutes, { prefix: "/users" });
await app.register(tipsRoutes, { prefix: "/tips" });
await app.register(gamesRoutes, { prefix: "/games" });
await app.register(gamesLiveRoutes, { prefix: "/games-live" });
await app.register(vipRoutes, { prefix: "/vip" });
await app.register(paymentsRoutes, { prefix: "/payments" });
await app.register(followsRoutes, { prefix: "/follows" });
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

// Telegram listener + OCR queue, same process/machine as the API — see
// apps/worker/src/index.ts and apps/api/Dockerfile for why. Only set in
// production (TELEGRAM_API_ID absent locally), so `npm run dev:api` never
// tries to connect to Telegram.
if (process.env.TELEGRAM_API_ID) {
  const { startTelegramWorker } = await import("@evobo/worker");
  startTelegramWorker().catch((err) => app.log.error({ err }, "telegram worker crashed"));
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
