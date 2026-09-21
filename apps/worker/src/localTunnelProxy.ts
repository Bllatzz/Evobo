import { timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { TUNNEL_SECRET_HEADER } from "./tunnelAuth.js";

/**
 * A conta grátis do ngrok só dá 1 domínio fixo — pra expor Ollama (OCR) e o
 * bet-analytix-fetcher pelo MESMO túnel, esse proxy roteia por path antes
 * de repassar pra porta certa: /bankroll/* -> fetcher (3939), resto -> Ollama
 * (11434, cujos próprios paths já começam com /api/, nunca colidem com
 * /bankroll/*). Só o ngrok tunnela esta porta (ver ngrok.yml).
 *
 * Como o túnel é público, só passa o que o worker realmente usa (allowlist de
 * método + path) — nada de /api/pull, /api/delete etc. do Ollama. Se
 * TUNNEL_SECRET estiver definido, também exige o header x-tunnel-secret.
 */
const PORT = Number(process.env.TUNNEL_PROXY_PORT ?? 8080);
const OLLAMA_PORT = Number(process.env.OLLAMA_PORT ?? 11434);
const FETCHER_PORT = Number(process.env.BET_ANALYTIX_FETCHER_PORT ?? 3939);
const TUNNEL_SECRET = process.env.TUNNEL_SECRET;

const OLLAMA_PATHS = new Set(["/api/generate", "/api/chat"]);
const BANKROLL_PATH = /^\/bankroll\/[0-9]+\/?$/;

function routeFor(method: string | undefined, url: string | undefined): number | null {
  const path = (url ?? "").split("?")[0]!;
  if (method === "GET" && BANKROLL_PATH.test(path)) return FETCHER_PORT;
  if (method === "POST" && OLLAMA_PATHS.has(path)) return OLLAMA_PORT;
  return null;
}

function hasValidSecret(provided: string | string[] | undefined): boolean {
  if (!TUNNEL_SECRET) return true; // opt-in: sem segredo configurado, só a allowlist vale
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(TUNNEL_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = createServer((req, res) => {
  const targetPort = routeFor(req.method, req.url);
  if (targetPort === null) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not_found" }));
    return;
  }
  if (!hasValidSecret(req.headers[TUNNEL_SECRET_HEADER])) {
    res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

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
  console.log(`[tunnel-proxy] rodando em http://localhost:${PORT} — /bankroll/* -> :${FETCHER_PORT}, /api/generate|chat -> :${OLLAMA_PORT}`);
  if (!TUNNEL_SECRET) {
    console.warn("[tunnel-proxy] TUNNEL_SECRET não definido — o túnel só está protegido pela allowlist de paths, sem senha.");
  }
});
