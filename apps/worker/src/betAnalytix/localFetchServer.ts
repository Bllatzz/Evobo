import { createServer } from "node:http";
import { fetchBankrollBetsLocally } from "./playwrightFetch.js";

/**
 * Roda no PC do usuário (npm run bet-analytix-fetcher), exposto pra
 * produção via túnel (ngrok, mesmo padrão do Ollama/OCR) — o worker do Fly
 * chama esse servidor em vez de rodar o Chromium ele mesmo (imagem Alpine,
 * sem glibc, e o tamanho explode ~10x com o --with-deps do Playwright).
 * Uma rota só: GET /bankroll/:id -> { bets: BetAnalytixBet[] }.
 */
const PORT = Number(process.env.BET_ANALYTIX_FETCHER_PORT ?? 3939);

// Cada request abre um Chromium — um por vez, senão o túnel público vira uma
// forma de esgotar o PC. Quem chegar com outro em andamento leva 429.
let busy = false;

const server = createServer(async (req, res) => {
  const match = req.url?.match(/^\/bankroll\/([0-9]+)\/?$/);
  if (req.method !== "GET" || !match) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not_found" }));
    return;
  }
  if (busy) {
    res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ error: "busy" }));
    return;
  }

  const bankrollId = match[1]!;
  busy = true;
  try {
    const bets = await fetchBankrollBetsLocally(bankrollId);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ bets }));
  } catch (err) {
    console.error(`[bet-analytix-fetcher] falha no bankroll ${bankrollId}:`, err);
    res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: "fetch_failed" }));
  } finally {
    busy = false;
  }
});

server.listen(PORT, () => {
  console.log(`[bet-analytix-fetcher] rodando em http://localhost:${PORT}`);
});
