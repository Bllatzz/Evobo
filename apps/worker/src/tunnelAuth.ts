/**
 * Segredo compartilhado do túnel do PC (ngrok → localTunnelProxy.ts). O
 * proxy só exige o header quando TUNNEL_SECRET está definido no PC; quem
 * chama o túnel (worker do Fly: Ollama + bet-analytix-fetcher) manda o
 * header sempre que a variável existir do lado dele. Definir o MESMO valor
 * nos dois lados — worker primeiro, depois o proxy — pra não derrubar o OCR.
 */
export const TUNNEL_SECRET_HEADER = "x-tunnel-secret";

export function tunnelHeaders(): Record<string, string> {
  const secret = process.env.TUNNEL_SECRET;
  return secret ? { [TUNNEL_SECRET_HEADER]: secret } : {};
}
