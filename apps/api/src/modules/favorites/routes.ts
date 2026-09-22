import type { FastifyInstance } from "fastify";
import { AddFavoriteInput, FavoriteKind } from "@evobo/shared-types";
import { authGuard } from "../../middleware/authGuard.js";
import { prisma } from "../../db/prisma.js";

/** Starred teams/leagues for the Jogos page — see the UserFavorite model. */
export async function favoritesRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: authGuard }, async (request) => {
    return prisma.userFavorite.findMany({
      where: { userId: request.authUser!.id },
      select: { kind: true, externalId: true, name: true, imageUrl: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  });

  app.post("/", { preHandler: authGuard }, async (request, reply) => {
    const parsed = AddFavoriteInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const { kind, externalId, name, imageUrl } = parsed.data;
    const userId = request.authUser!.id;

    // Re-starring refreshes the snapshot (a team's crest URL or a league's
    // name can change upstream).
    await prisma.userFavorite.upsert({
      where: { userId_kind_externalId: { userId, kind, externalId } },
      create: { userId, kind, externalId, name, imageUrl: imageUrl ?? null },
      update: { name, imageUrl: imageUrl ?? null },
    });

    return reply.code(204).send();
  });

  app.delete<{ Params: { kind: string; externalId: string } }>(
    "/:kind/:externalId",
    { preHandler: authGuard },
    async (request, reply) => {
      const kind = FavoriteKind.safeParse(request.params.kind);
      if (!kind.success) return reply.code(400).send({ error: "invalid_kind" });

      await prisma.userFavorite.deleteMany({
        where: { userId: request.authUser!.id, kind: kind.data, externalId: request.params.externalId },
      });

      return reply.code(204).send();
    },
  );
}
