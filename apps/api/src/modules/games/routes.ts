import type { FastifyInstance } from "fastify";
import { CreateGameInput, UpdateGameInput } from "@evobo/shared-types";
import { authGuard } from "../../middleware/authGuard.js";
import { roleGuard } from "../../middleware/roleGuard.js";
import { prisma } from "../../db/prisma.js";

/**
 * Minimal reference-data endpoints — no external sports-data source is
 * wired up yet (open item, see project memory), so games are entered and
 * scored manually for now. Not scoped to any particular role: multi-tenant,
 * anyone can publish a tip, and a tip needs a game to point at.
 */
export async function gamesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { status?: string; q?: string; date?: string } }>(
    "/",
    async (request, reply) => {
      const q = request.query.q?.trim();
      const { date } = request.query;

      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return reply.code(400).send({ error: "invalid_date" });
      }

      return prisma.game.findMany({
        where: {
          ...(request.query.status ? { status: request.query.status as never } : {}),
          ...(q
            ? {
                OR: [
                  { homeTeam: { contains: q, mode: "insensitive" } },
                  { awayTeam: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
          ...(date
            ? {
                startsAt: {
                  gte: new Date(`${date}T00:00:00.000Z`),
                  lt: new Date(`${date}T23:59:59.999Z`),
                },
              }
            : {}),
        },
        orderBy: { startsAt: "asc" },
        take: 50,
      });
    },
  );

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const game = await prisma.game.findUnique({ where: { id: request.params.id } });
    if (!game) return reply.code(404).send({ error: "not_found" });
    return game;
  });

  app.post("/", { preHandler: authGuard }, async (request, reply) => {
    const parsed = CreateGameInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }

    const game = await prisma.game.create({
      data: {
        homeTeam: parsed.data.homeTeam,
        awayTeam: parsed.data.awayTeam,
        league: parsed.data.league,
        startsAt: new Date(parsed.data.startsAt),
      },
    });

    return reply.code(201).send(game);
  });

  // Scores/status are "synced by the backend only" (see games RLS policy comment)
  // — open POST lets any tipster point a tip at a new fixture, but editing an
  // existing game's result affects every tip already pointing at it, so that's
  // admin-only.
  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authGuard, roleGuard("admin")] },
    async (request, reply) => {
      const parsed = UpdateGameInput.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
      }

      const game = await prisma.game
        .update({ where: { id: request.params.id }, data: parsed.data })
        .catch(() => null);
      if (!game) return reply.code(404).send({ error: "not_found" });

      return game;
    },
  );
}
