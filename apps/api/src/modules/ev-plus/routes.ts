import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { authGuard } from "../../middleware/authGuard.js";

/**
 * EV+ — "Darwin AI" market predictions, read live from robotip's own
 * `model_predictions` API (the same endpoint that backs
 * https://robotip.com.br/ev_table). No cookies needed to call it at all —
 * but robotip gates most of the *payload* server-side by session: an
 * anonymous request comes back with odd_bookie populated for only a
 * handful of scheduled games (confirmed: 4 out of 536 in one sample),
 * while a logged-in account's session cookie unlocks the rest (638/638 in
 * the same sample — a ~150x jump). EV_PLUS_ROBOTIP_SESSION_COOKIE carries
 * that account's `session` cookie value so we get the same data the
 * account sees on the site. This is inherently fragile — it rides on one
 * person's login session, which can expire or get invalidated by a
 * password change/logout elsewhere — so a missing/stale cookie must
 * degrade to the anonymous (smaller) result, never a hard failure.
 *
 * Mirrors robotip's own table: every market side with a real bookmaker odd
 * is returned (positive AND negative EV), not just the positive-value ones
 * — the frontend surfaces value via color/sort, it doesn't hide the rest.
 *
 * Only `goals_model` is live on robotip today (no corners/cards model yet)
 * — nothing here assumes that, so a future model shows up automatically.
 */

const ROBOTIP_PUBLIC_URL = process.env.EV_PLUS_ROBOTIP_URL ?? "https://robotip.com.br";
// Raw `session=...` cookie from a logged-in robotip account — see the file
// header. Optional: unset just means the smaller anonymous payload.
const ROBOTIP_SESSION_COOKIE = process.env.EV_PLUS_ROBOTIP_SESSION_COOKIE;
const EXTERNAL_FETCH_TIMEOUT_MS = 15_000;
// The response is a multi-MB unfiltered dump of every prediction (past and
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
      headers: ROBOTIP_SESSION_COOKIE ? { Cookie: ROBOTIP_SESSION_COOKIE } : undefined,
    });
    if (!res.ok) throw new Error(`robotip responded ${res.status}`);
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) throw new Error("unexpected model_predictions response shape");
    cache = { rows: rows as ModelPrediction[], fetchedAt: Date.now() };
    const withOdd = cache.rows.filter((r) => r.odd_bookie !== null).length;
    log.info({ total: cache.rows.length, withOdd }, "EV+ model_predictions refreshed");
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

    // A row is worth showing once it has a real bookmaker odd on a real
    // market (odd_name/odd_bookie/prob_fair/line all present — most rows
    // carry an `ev` with none of those, a pre-market model score with
    // nothing to bet on yet) and the game hasn't finished (time_status 3).
    // Unlike an earlier version of this endpoint, EV sign is NOT filtered
    // here — robotip's own ev_table lists every market side (over AND
    // under) it has odds for, negative EV included, same as this does now;
    // the frontend colors/sorts by EV instead of us hiding rows server-side.
    const actionable = rows.filter(
      (r): r is ModelPrediction & { odd_name: string; odd_bookie: number; prob_fair: number; line: number; over_under: "over" | "under" } =>
        r.odd_name !== null &&
        r.odd_bookie !== null &&
        r.prob_fair !== null &&
        r.line !== null &&
        r.over_under !== null &&
        r.time_status !== 3,
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
      .slice(0, 1000)
      .map((r) => ({
        id: r.id,
        gameId: r.game_id,
        market: `${r.over_under === "over" ? "Mais" : "Menos"} de ${formatLine(r.line)} gols`,
        marketCategory: "Gols" as const, // only goals_model is live today — see file header
        side: r.over_under,
        bookie: bookieLabel(r.odd_name),
        evPct: Math.round(r.ev * 10_000) / 100,
        oddBookie: r.odd_bookie,
        oddFair: Math.round((1 / r.prob_fair) * 1000) / 1000,
        probFairPct: Math.round(r.prob_fair * 1000) / 10,
        homeTeam: r.home_name,
        awayTeam: r.away_name,
        homeImageUrl: teamImageUrl(r.home_id),
        awayImageUrl: teamImageUrl(r.away_id),
        competition: r.league_name,
        kickoff: new Date(r.timestamp * 1000).toISOString(),
        status: r.time_status === 1 ? ("live" as const) : ("upcoming" as const),
        analysis: r.ai_analytics?.pt ?? null,
      }));

    return { picks, unavailable };
  });
}
