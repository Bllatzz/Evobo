import { startExtractDetailsWorker } from "./queues/extractDetailsWorker.js";

/**
 * Entrypoint pra rodar SÓ o consumidor da fila `extract-details` (OCR),
 * sem o listener do Telegram (index.ts) — pensado pra rodar no PC do
 * usuário, apontando pro Redis/banco/Supabase de produção via
 * .env.ocr-worker (ver .env.ocr-worker.example), com OCR_PROVIDER=ollama.
 * Dois workers (este + o do Fly) consomem a mesma fila do Upstash sem
 * duplicar processamento — o BullMQ garante que cada job é pego por só um.
 * Não inicia o client MTProto: rodar startTelegramWorker() aqui em paralelo
 * com o do Fly derrubaria a sessão TELEGRAM_SESSION um do outro.
 */
startExtractDetailsWorker();
console.log("[ocr-worker] rodando, provider =", process.env.OCR_PROVIDER === "ollama" ? "ollama" : "gemini");

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
