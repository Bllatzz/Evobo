import { Prisma, PrismaClient } from "@prisma/client";

/** Single Prisma client for the process — avoids exhausting Postgres connections under BullMQ/Socket.io concurrency. */
export const prisma = new PrismaClient();

/**
 * Runs `fn` inside a transaction with one of the users/tips privileged-write
 * guard GUCs set, so the corresponding trigger (see the rls_trigger_seed
 * migration) lets the write through. Use this ONLY for the specific
 * endpoints that are supposed to change role_id/verified_at/is_active or
 * tip.status — everywhere else should go through the plain `prisma` client
 * so the guard stays in effect.
 */
export function withPrivilegedWrite<T>(
  guard: "user" | "tipStatus",
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const flag = guard === "user" ? "app.bypass_user_guard" : "app.bypass_tip_status_guard";
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ${flag} = 'true'`);
    return fn(tx);
  });
}
