import type { BetAnalytixBet } from "./playwrightFetch.js";

export type { BetAnalytixBet };

const FETCH_TIMEOUT_MS = 60_000;

/**
 * Chama o servidor local (localFetchServer.ts, rodando no PC do usuário,
 * exposto via túnel — mesmo padrão do OCR/Ollama) em vez de rodar o
 * Chromium aqui: essa é a versão que roda dentro do Fly, que não tem
 * Playwright/Chromium instalado (ver Dockerfile).
 */
export async function fetchBankrollBets(bankrollId: string): Promise<BetAnalytixBet[]> {
  const fetcherUrl = process.env.BET_ANALYTIX_FETCHER_URL;
  if (!fetcherUrl) throw new Error("BET_ANALYTIX_FETCHER_URL não configurado (transitório: servidor local pode estar desligado)");

  const res = await fetch(`${fetcherUrl}/bankroll/${bankrollId}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`bet-analytix-fetcher respondeu ${res.status} pro bankroll ${bankrollId}: ${detail}`);
  }

  const json = (await res.json()) as { bets?: BetAnalytixBet[] };
  return json.bets ?? [];
}
