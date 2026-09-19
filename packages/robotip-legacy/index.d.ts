// Tipagem ambiente mínima — o pacote em si continua JS puro (CommonJS) até a
// conversão pra TS planejada como segunda fase, depois que o comportamento
// estiver validado em produção.
import type { RequestListener } from "node:http";

export function createApp(): RequestListener;
export function startTelegramListener(): Promise<never>;
export function startCornerAutoChecker(): void;
export function startHomeWinAutoChecker(): void;
