import { chromium } from "playwright";

export type BetAnalytixBet = {
  date: number; // unix seconds
  label: string;
  odds: number;
  stake: number;
  gain: number;
  profit: number;
  bookmaker: string;
  /** 0 = pending, 1 = green, 2 = red — no void/reembolso state observed yet. */
  state: number;
};

const NAV_TIMEOUT_MS = 30_000;

/** Raw shape of one row from GET .../bets/paginated — everything else in
 * the response is account/UI bookkeeping we don't need. Confirmed against
 * both known bankrolls (2026-09-12). */
type RawBet = {
  date: number;
  label: string;
  odds: string;
  stake: string;
  gain: string;
  profit: string;
  bookmaker: string;
  state: number;
};

/**
 * Abre a página pública do bankroll num browser de verdade e INTERCEPTA a
 * requisição que a própria página faz ao carregar — nunca chama a API
 * direto (nem de dentro da página via `fetch` manual): o endpoint exige um
 * header `sid` que só o código da própria página sabe gerar/anexar, e uma
 * chamada de fetch nossa (mesmo rodando no contexto da página) não passa
 * por esse mecanismo e volta `{"error":"Error System"}`. Sempre fecha o
 * browser, mesmo em erro.
 *
 * Só roda LOCALMENTE (via localFetchServer.ts, no PC do usuário) — o
 * Chromium não roda na imagem de produção do Fly (Alpine, sem glibc, e o
 * tamanho da imagem explode ~10x com o --with-deps). O worker do Fly nunca
 * importa este arquivo diretamente, só chama o servidor local pelo túnel —
 * ver fetchBankroll.ts.
 */
export async function fetchBankrollBetsLocally(bankrollId: string): Promise<BetAnalytixBet[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const responsePromise = page.waitForResponse((res) => res.url().includes("bets/paginated"), {
      timeout: NAV_TIMEOUT_MS,
    });

    await page.goto(`https://app.bet-analytix.com/bankroll/${bankrollId}`, {
      waitUntil: "load",
      timeout: NAV_TIMEOUT_MS,
    });

    const res = await responsePromise;
    if (!res.ok()) throw new Error(`bet-analytix respondeu ${res.status()} pro bankroll ${bankrollId}`);

    const json = (await res.json()) as { bets?: RawBet[] };
    if (!Array.isArray(json.bets)) return [];

    return json.bets.map((b) => ({
      date: b.date,
      label: b.label.trim(),
      odds: Number(b.odds),
      stake: Number(b.stake),
      gain: Number(b.gain),
      profit: Number(b.profit),
      bookmaker: b.bookmaker,
      state: b.state,
    }));
  } finally {
    await browser.close();
  }
}
