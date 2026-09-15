import { Queue, Worker } from "bullmq";
import type { TelegramClient } from "telegram";
import { runVipTradeBacktest, type VipBacktestResult } from "../vipTradeBacktest.js";

const QUEUE_NAME = "vip-backtest";

export type VipBacktestJob = { groupNameOrChatId: string; sinceUnix: number; untilUnix: number; reaisPerPercent: number };

// Mesma forma da connection() de extractDetailsWorker.ts — bullmq bundla seu
// próprio ioredis, não aceita uma instância `Redis` construída do ioredis do
// workspace.
function connection() {
  const url = new URL(process.env.REDIS_URL!);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

export const vipBacktestQueue = new Queue<VipBacktestJob, VipBacktestResult>(QUEUE_NAME, { connection: connection() });

/**
 * Job pontual (não uma feature permanente): só existe pra rodar o backtest
 * de um grupo ainda não rastreado usando o client MTProto já conectado do
 * worker, sem precisar de um endpoint HTTP autenticado nem abrir uma 2ª
 * conexão Telegram — quem dispara é um script via Redis (mesma infra da
 * fila de OCR), não a UI.
 */
export function startVipBacktestWorker(client: TelegramClient): Worker<VipBacktestJob, VipBacktestResult> {
  const worker = new Worker<VipBacktestJob, VipBacktestResult>(
    QUEUE_NAME,
    async (job) => runVipTradeBacktest(client, job.data.groupNameOrChatId, job.data.sinceUnix, job.data.untilUnix, job.data.reaisPerPercent),
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    console.error(`[vip-backtest] job ${job?.id} falhou:`, err?.message);
  });
  return worker;
}
