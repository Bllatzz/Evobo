import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { authGuard } from "../../middleware/authGuard.js";

/**
 * EV+ — "Darwin AI" positive-expected-value picks, read live from robotip's
 * own public `model_predictions` API (the same endpoint that backs
 * https://robotip.com.br/ev_table). Confirmed with a plain unauthenticated
 * GET — no cookies, no login, no headers needed — so unlike Neo IA (see the
 * removed neoia-scraper module, blocked forever on credentials + an unknown
 * chat API), this one just needed the endpoint found and the response shape
 * reverse-engineered from a real page load.
 *
 * Only `goals_model` is live on robotip today (no corners/cards model yet)
 * — nothing here assumes that, so a future model shows up automatically.
 */

const ROBOTIP_PUBLIC_URL = process.env.EV_PLUS_ROBOTIP_URL ?? "https://robotip.com.br";
const EXTERNAL_FETCH_TIMEOUT_MS = 15_000;
// The response is a ~1-2MB unfiltered dump of every prediction (past and
// future) in the window — too heavy to refetch on every EvPage view.
const CACHE_TTL_MS = 3 * 60_000;

/** Shape returned by GET /api/model_predictions on robotip.com.br — one row per bookmaker odd per market side. */
type ModelPrediction = {
  id: number;
  over_under: "over" | "under" | null;
  odd_name: string | null;
  odd_bookie: number | null;
  prob_fair: number | null;
  ev: number;
  line: number | null;
  time_status: number;
  timestamp: number;
  updated_at: number;
  game_id: string;
  home_id: string;
  away_id: string;
  home_name: string;
  away_name: string;
  league_name: string | null;
  ai_analytics: { pt: string; en: string } | null;
};

let cache: { rows: ModelPrediction[]; fetchedAt: number } | null = null;

/** Fetches today .. +3 days of predictions, cached for a few minutes. `unavailable: true` means the
 * upstream fetch failed and there's no cached data to fall back on — callers must not present that as "no picks". */
async function fetchPredictions(
  log: FastifyBaseLogger,
): Promise<{ rows: ModelPrediction[]; unavailable: boolean }> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { rows: cache.rows, unavailable: false };
  }
  try {
    const from = Math.floor(Date.now() / 86_400_000) * 86_400;
    const to = from + 3 * 86_400;
    const res = await fetch(`${ROBOTIP_PUBLIC_URL}/api/model_predictions?from=${from}&to=${to}`, {
      signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`robotip responded ${res.status}`);
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) throw new Error("unexpected model_predictions response shape");
    cache = { rows: rows as ModelPrediction[], fetchedAt: Date.now() };
    return { rows: cache.rows, unavailable: false };
  } catch (err) {
    log.error({ err }, "failed to fetch EV+ model_predictions from robotip");
    return { rows: cache?.rows ?? [], unavailable: !cache };
  }
}

/** Same asset host the ev_table page itself renders team crests from (`b` = the only size confirmed live). */
function teamImageUrl(teamId: string): string {
  return `${ROBOTIP_PUBLIC_URL}/robotip_imgs/teams_imgs/b/${teamId}.png`;
}

const BOOKIE_LABELS: Record<string, string> = {
  betbra: "BetBRA",
  bolsa: "Bolsa de Apostas",
};

/** odd_name looks like "betbra_ou_gols_odd_over_odd_line25_lay" — direction and line already
 * come from the over_under/line fields, the only thing worth pulling out of this string is which
 * bookmaker/exchange it is and whether it's the exchange's lay side, since that's what tells apart
 * multiple rows on the exact same match/market (see the dedupe key below, which is NOT this). */
function bookieLabel(oddName: string): string | null {
  const m = oddName.match(/^([a-z]+)_ou_gols_odd_(?:over|under)_odd_line\d+(_lay)?$/);
  if (!m) return null;
  const label = BOOKIE_LABELS[m[1]!];
  if (!label) return null;
  return m[2] ? `${label} (Lay)` : label;
}

function formatLine(line: number): string {
  return Number.isInteger(line) ? String(line) : String(Math.round(line * 100) / 100);
}

export async function evPlusRoutes(app: FastifyInstance) {
  // "EV+" is a role-gated screen (ev_plus in the seed, disabled for regular
  // users until an admin re-enables it — see the ev_plus_disabled_by_default
  // migration) — the frontend hides it via RouteGuard, but same as
  // robot-signals, the backend only enforces "must be logged in" here, not
  // the screen-specific grant (screens are a visibility gate, not a hard
  // security boundary, and the data itself is robotip's own public feed).
  app.addHook("preHandler", authGuard);

  app.get("/", async (request) => {
    const { rows, unavailable } = await fetchPredictions(request.log);
    const nowSec = Date.now() / 1000;

    // "EV+" means genuinely actionable value bets: a real bookmaker odd on
    // a real market (odd_name/odd_bookie/prob_fair/line all present — some
    // rows carry an `ev` with none of those, seemingly a pre-market-match
    // model score with nothing to bet on yet), positive edge, and the game
    // hasn't kicked off (time_status 0) with a kickoff still in the future
    // (a stale "scheduled" row whose time has already passed isn't bettable).
    const actionable = rows.filter(
      (r): r is ModelPrediction & { odd_name: string; odd_bookie: number; prob_fair: number; line: number; over_under: "over" | "under" } =>
        r.odd_name !== null &&
        r.odd_bookie !== null &&
        r.prob_fair !== null &&
        r.line !== null &&
        r.over_under !== null &&
        r.ev > 0 &&
        r.time_status === 0 &&
        r.timestamp > nowSec,
    );

    // The model can re-emit the same bookmaker's odd for the same match as
    // it refreshes (e.g. the bookie moved its line) — keep only the latest
    // snapshot per (game, odd_name). Different bookmakers/exchanges on the
    // same match+market are different odd_names (see bookieLabel) and are
    // deliberately NOT merged — those are genuinely different offers.
    const latestByKey = new Map<string, (typeof actionable)[number]>();
    for (const r of actionable) {
      const key = `${r.game_id}|${r.odd_name}`;
      const existing = latestByKey.get(key);
      if (!existing || r.updated_at > existing.updated_at) latestByKey.set(key, r);
    }

    const picks = [...latestByKey.values()]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, 60)
      .map((r) => ({
        id: r.id,
        market: `${r.over_under === "over" ? "Over" : "Under"} ${formatLine(r.line)} Goals`,
        bookie: bookieLabel(r.odd_name),
        evPct: Math.round(r.ev * 1000) / 10,
        oddBookie: r.odd_bookie,
        oddFair: Math.round((1 / r.prob_fair) * 100) / 100,
        homeTeam: r.home_name,
        awayTeam: r.away_name,
        homeImageUrl: teamImageUrl(r.home_id),
        awayImageUrl: teamImageUrl(r.away_id),
        competition: r.league_name,
        kickoff: new Date(r.timestamp * 1000).toISOString(),
        analysis: r.ai_analytics?.pt ?? null,
      }));

    return { picks, unavailable };
  });
}
