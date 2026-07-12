import type { FastifyInstance } from "fastify";
import { authGuard } from "../../middleware/authGuard.js";
import { prisma } from "../../db/prisma.js";

export async function followsRoutes(app: FastifyInstance) {
  app.post<{ Params: { userId: string } }>(
    "/:userId",
    { preHandler: authGuard },
    async (request, reply) => {
      if (request.params.userId === request.authUser!.id) {
        return reply.code(400).send({ error: "cannot_follow_self" });
      }

      await prisma.follow.upsert({
        where: {
          followerId_followedId: {
            followerId: request.authUser!.id,
            followedId: request.params.userId,
          },
        },
        create: { followerId: request.authUser!.id, followedId: request.params.userId },
        update: {},
      });

      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { userId: string } }>(
    "/:userId",
    { preHandler: authGuard },
    async (request, reply) => {
      await prisma.follow
        .delete({
          where: {
            followerId_followedId: {
              followerId: request.authUser!.id,
              followedId: request.params.userId,
            },
          },
        })
        .catch(() => null);

      return reply.code(204).send();
    },
  );
}
