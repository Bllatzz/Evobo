import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";

/** Records sensitive admin actions (permission changes, VIP grants, payment approvals). Never pass secrets/tokens in metadata. */
export async function recordAuditLog(params: {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId ?? null,
      metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
