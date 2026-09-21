export type TippyStatus = "Won" | "Lost" | "Void" | "Pending";

export type TippyCall = {
  id: number;
  /** Epoch ms — o `date` do Tippy ("YYYY-MM-DD HH:MM:SS") é horário de
   * Brasília (UTC-3, sem horário de verão desde 2019), medido contra a hora
   * da mensagem no Telegram (diferença de 0-3s nas 200 calls conferidas). */
  at: number;
  event: string;
  selection: string;
  odds: number;
  stake: number;
  status: TippyStatus;
  /** Lucro em unidades, já com o resultado aplicado; null enquanto pendente. */
  profit: number | null;
  /** Fora do registro público do canal ("maioria não pegou" ou "decisão do
   * admin"); o resultado em si continua valendo, ver matchTippyCalls.ts. */
  discarded: boolean;
  discardReason: string | null;
};

const TIPPY_CALLS_URL = "https://app.tippybot.com.br/publico/calls";
const FETCH_TIMEOUT_MS = 30_000;
const STATUSES = new Set<string>(["Won", "Lost", "Void", "Pending"]);

/** Raw shape de uma call em GET /publico/calls — o resto (adesão, esporte,
 * casa, ids de origem...) é contabilidade do painel que a gente não usa.
 * Confirmado contra o canal Padovan NBA/NFL (2026-09-21, 9115 calls). */
type RawCall = {
  id: number;
  date: string;
  event: string | null;
  selection: string | null;
  odds: number;
  stake: number;
  status: string;
  profit: number | null;
  descartada: boolean;
  motivo_descarte: string | null;
};

function parseCall(raw: RawCall): TippyCall | null {
  if (typeof raw.date !== "string" || typeof raw.odds !== "number" || typeof raw.stake !== "number") return null;
  if (!STATUSES.has(raw.status)) return null;
  const at = Date.parse(`${raw.date.replace(" ", "T")}-03:00`);
  if (Number.isNaN(at)) return null;

  return {
    id: raw.id,
    at,
    event: raw.event ?? "",
    selection: raw.selection ?? "",
    odds: raw.odds,
    stake: raw.stake,
    status: raw.status as TippyStatus,
    profit: typeof raw.profit === "number" ? raw.profit : null,
    discarded: raw.descartada === true,
    discardReason: raw.motivo_descarte ?? null,
  };
}

/** `sinceMs` descarta o histórico antigo (o servidor não filtra por período,
 * a resposta traz o canal inteiro). Linha malformada é ignorada em vez de
 * derrubar a leitura toda. Exportado à parte do fetch pra dar pra rodar o
 * mesmo parse contra um JSON salvo (ver o dry-run da mudança que criou isto). */
export function parseTippyCalls(json: unknown, sinceMs: number): TippyCall[] {
  if (!Array.isArray(json)) throw new Error("tippy: resposta inesperada (não é uma lista de calls)");

  const calls: TippyCall[] = [];
  for (const raw of json as RawCall[]) {
    const call = parseCall(raw);
    if (call && call.at >= sinceMs) calls.push(call);
  }
  return calls;
}

/**
 * Lê o histórico do canal direto do JSON que a própria página pública do
 * Tippy consome (`fetch` puro — ao contrário do bet-analytix, não precisa de
 * Chromium nem de túnel pro PC, roda direto no Fly). ~230 KB comprimido.
 */
export async function fetchTippyCalls(token: string, sinceMs: number): Promise<TippyCall[]> {
  const res = await fetch(`${TIPPY_CALLS_URL}?t=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    // Link revogado/expirado volta 4xx com { mensagem } — o corpo é o
    // diagnóstico mais útil, e nunca inclui o token.
    const detail = await res.text().catch(() => "");
    throw new Error(`tippy respondeu ${res.status}: ${detail.slice(0, 200)}`);
  }

  return parseTippyCalls(await res.json(), sinceMs);
}
