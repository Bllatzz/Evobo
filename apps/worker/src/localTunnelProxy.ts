import { createServer, request as httpRequest } from "node:http";

/**
 * A conta grátis do ngrok só dá 1 domínio fixo — pra expor Ollama (OCR) e o
 * bet-analytix-fetcher pelo MESMO túnel, esse proxy roteia por path antes
 * de repassar pra porta certa: /bankroll/* -> fetcher (3939), resto -> Ollama
 * (11434, cujos próprios paths já começam com /api/, nunca colidem com
 * /bankroll/*). Só o ngrok tunnela esta porta (ver ngrok.yml).
 */
const PORT = Number(process.env.TUNNEL_PROXY_PORT ?? 8080);
const OLLAMA_PORT = Number(process.env.OLLAMA_PORT ?? 11434);
const FETCHER_PORT = Number(process.env.BET_ANALYTIX_FETCHER_PORT ?? 3939);

const server = createServer((req, res) => {
  const targetPort = req.url?.startsWith("/bankroll/") ? FETCHER_PORT : OLLAMA_PORT;

  const proxyReq = httpRequest(
    { host: "127.0.0.1", port: targetPort, path: req.url, method: req.method, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (err) => {
    console.error(`[tunnel-proxy] falha repassando pra :${targetPort}:`, err);
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "proxy_failed" }));
  });
  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`[tunnel-proxy] rodando em http://localhost:${PORT} — /bankroll/* -> :${FETCHER_PORT}, resto -> :${OLLAMA_PORT}`);
});
