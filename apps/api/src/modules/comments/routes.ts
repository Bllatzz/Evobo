import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { CreateCommentInput } from "@evobo/shared-types";
import { authGuard, optionalAuthGuard } from "../../middleware/authGuard.js";
import { prisma } from "../../db/prisma.js";

/** Same visibility rule as tips/routes.ts's visibleTipsWhere — duplicated (a few lines) to keep modules decoupled rather than cross-importing. */
async function visibleTipsWhere(viewerId?: string): Promise<Prisma.TipWhereInput> {
  if (!viewerId) return { visibility: "public" };

  const activeGroups = await prisma.vipSubscription.findMany({
    where: { userId: viewerId, status: "active", expiresAt: { gt: new Date() } },
    select: { vipGroupId: true },
  });

  return {
    OR: [
      { visibility: "public" },
      { authorId: viewerId },
      ...(activeGroups.length
        ? [{ vipGroupId: { in: activeGroups.map((g) => g.vipGroupId) } }]
        : []),
    ],
  };
}

export async function commentsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { tipId?: string } }>(
    "/",
    { preHandler: optionalAuthGuard },
    async (request, reply) => {
      if (!request.query.tipId) {
        return reply.code(400).send({ error: "tipId_required" });
      }

      const tipWhere = await visibleTipsWhere(request.authUser?.id);
      const tip = await prisma.tip.findFirst({ where: { id: request.query.tipId, ...tipWhere } });
      if (!tip) return reply.code(404).send({ error: "not_found" });

      return prisma.comment.findMany({
        where: { tipId: tip.id, isDeleted: false },
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      });
    },
  );

  app.post<{ Querystring: { tipId?: string } }>(
    "/",
    { preHandler: authGuard },
    async (request, reply) => {
      const tipId = request.query.tipId;
      if (!tipId) return reply.code(400).send({ error: "tipId_required" });

      const parsed = CreateCommentInput.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
      }

      const tipWhere = await visibleTipsWhere(request.authUser!.id);
      const tip = await prisma.tip.findFirst({ where: { id: tipId, ...tipWhere } });
      if (!tip) return reply.code(404).send({ error: "not_found" });

      const comment = await prisma.comment.create({
        data: { tipId: tip.id, authorId: request.authUser!.id, content: parsed.data.content },
        include: {
          author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      });

      return reply.code(201).send(comment);
    },
  );
}
