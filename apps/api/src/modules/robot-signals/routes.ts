import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { authGuard } from "../../middleware/authGuard.js";
import { normalizeMarket } from "./marketNormalizer.js";

/**
 * Proxies robotip's own live alerts API (~/desenvolvimento/robotip/backend,
 * deployed at ROBOTIP_API_URL, no auth) instead of reading a local snapshot —
 * a one-time CSV import was tried first, but it was a static export (all
 * rows from a single day months ago, permanently stuck at whatever "result"
 * they had at export time), so it looked like fake/stale alerts next to the
 * real robotip dashboard. Hitting the same API their own dashboard's "Evobo"
 * bot filter uses keeps this genuinely live with zero extra infra.
 *
 * Multiple bots often fire on the exact same market for the exact same
 * match (e.g. 4 different corner bots all signaling "Over 0.5 Corners" on
 * one game) — betting-userbot's real auto-bet bridge merges those into a
 * single stake (chaveAposta = time_casa|time_visitante|mercado|direcao,
 * see ~/desenvolvimento/robotip/betting-userbot/src/server.js). This route
 * mirrors that: alerts are grouped by (teams, normalized market) and merged
 * into one card per group. Each bot carries its own suggested unit (the
 * "Stake: X%" line robotip's parser reads off the alert text, stored as
 * stake_pct, defaulting to 1u — same field aggregatePerformance below uses),
 * and when several bots agree on the same card their units add up (a 2u bot
 * plus a 1u bot agreeing suggests 3u, not a flat 1u). Cards within a group
 * more than 3h apart are NOT merged — that gap is longer than any single
 * match, so it means two different fixtures between the same two teams (a
 * rematch on another date), not one.
 */

const ROBOTIP_API_URL = process.env.ROBOTIP_API_URL ?? "https://robotip-analyzer.fly.dev";

/** Shape returned by GET /api/alerts on robotip's backend (backend/src/routes/alerts.js) — snake_case, straight off the `alerts` table. */
type RobotipAlert = {
  id: number;
  bot_name: string | null;
  odds: string | null;
  bet_odds: string | null;
  home_team: string | null;
  away_team: string | null;
  bet365_url: string | null;
  competition: string | null;
  score_home: number | null;
  score_away: number | null;
  game_minute: number | null;
  last_goal_minute: number | null;
  last_corner_minute: number | null;
  corners_home: number | null;
  corners_away: number | null;
  dangerous_home: number | null;
  dangerous_away: number | null;
  dangerous_per_min_5: string | null;
  yellow_home: number | null;
  yellow_away: number | null;
  red_home: number | null;
  red_away: number | null;
  shots_side_home: number | null;
  shots_side_away: number | null;
  shots_target_home: number | null;
  shots_target_away: number | null;
  possession_home: string | null;
  possession_away: string | null;
  received_at: string;
  result: string;
  raw_message: string | null;
  stake_pct: string | null;
};

/** Normalized shape the rest of this route (grouping/merging/normalizeMarket) works with. */
type Signal = {
  id: number;
  botName: string | null;
  rawMessage: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  competition: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
  gameMinute: number | null;
  lastGoalMinute: number | null;
  lastCornerMinute: number | null;
  odds: string | null;
  result: string;
  receivedAt: Date;
  bet365Url: string | null;
  cornersHome: number | null;
  cornersAway: number | null;
  dangerousHome: number | null;
  dangerousAway: number | null;
  dangerousPerMin5: string | null;
  yellowHome: number | null;
  yellowAway: number | null;
  redHome: number | null;
  redAway: number | null;
  shotsSideHome: number | null;
  shotsSideAway: number | null;
  shotsTargetHome: number | null;
  shotsTargetAway: number | null;
  possessionHome: string | null;
  possessionAway: string | null;
  stakePct: string | null;
};

function fromRobotipAlert(a: RobotipAlert): Signal {
  return {
    id: a.id,
    botName: a.bot_name,
    rawMessage: a.raw_message,
    homeTeam: a.home_team,
    awayTeam: a.away_team,
    competition: a.competition,
    scoreHome: a.score_home,
    scoreAway: a.score_away,
    gameMinute: a.game_minute,
    lastGoalMinute: a.last_goal_minute,
    lastCornerMinute: a.last_corner_minute,
    // robotip's `odds` column is frequently null — `bet_odds` is the one actually
    // locked in for the bet, and the only one robotip's own dashboard displays
    // (frontend/src/pages/DashboardPage.jsx: `alert.bet_odds ?? alert.odds`).
    odds: a.bet_odds ?? a.odds,
    result: a.result,
    receivedAt: new Date(a.received_at),
    bet365Url: a.bet365_url,
    cornersHome: a.corners_home,
    cornersAway: a.corners_away,
    dangerousHome: a.dangerous_home,
    dangerousAway: a.dangerous_away,
    dangerousPerMin5: a.dangerous_per_min_5,
    yellowHome: a.yellow_home,
    yellowAway: a.yellow_away,
    redHome: a.red_home,
    redAway: a.red_away,
    shotsSideHome: a.shots_side_home,
    shotsSideAway: a.shots_side_away,
    shotsTargetHome: a.shots_target_home,
    shotsTargetAway: a.shots_target_away,
    possessionHome: a.possession_home,
    possessionAway: a.possession_away,
    stakePct: a.stake_pct,
  };
}

/**
 * Shape returned by GET /api/gestao — robotip's own curated, hand-managed
 * bankroll ledger (backend/src/routes/gestao.js, table `gestao_banca`), NOT
 * the raw `alerts` table. It's populated from `alerts` via a manual `/sync`
 * and then hand-edited (odds fixed, results corrected, co-firing bots'
 * duplicate rows cleaned up) — this is what robotip's own "Gestão de Banca"
 * dashboard (frontend/src/pages/PerformancePage.jsx) computes its numbers
 * from. Performance/backtest figures we show MUST use this same source, or
 * they silently diverge from what the user sees in their own robotip app
 * (confirmed: the raw `alerts` feed gave a wildly different, even sign-
 * flipped, profit figure for a real bot compared to `gestao_banca`).
 * Unlike `/api/alerts`, this endpoint has no query filters or pagination —
 * it always returns the full table, so we fetch once and filter in Node.
 */
type GestaoRow = {
  id: number;
  bot_name: string | null;
  home_team: string | null;
  away_team: string | null;
  competition: string | null;
  result: "green" | "red" | "reembolso";
  bet_odds: string | null;
  stake_pct: string | null;
  received_at: string;
};

let gestaoCache: { rows: GestaoRow[]; fetchedAt: number } | null = null;
const GESTAO_CACHE_TTL_MS = 60_000;
const EXTERNAL_FETCH_TIMEOUT_MS = 10_000;

/** `Number(v)` that never lets a malformed third-party string field (e.g. "N/A")
 * turn into NaN and poison downstream sums — falls back instead of propagating. */
function toFiniteNumber(v: string | null | undefined, fallback: number | null): number | null {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Fetches the full curated ledger, cached for a minute — it's an unpaginated
 * ~20k-row response, too heavy to refetch on every Robô/Gráfico Robô page view.
 * `unavailable: true` means the upstream fetch failed and there's no cached
 * data to fall back on either — callers must not present that as "zero". */
async function fetchGestaoRows(
  log: FastifyBaseLogger,
): Promise<{ rows: GestaoRow[]; unavailable: boolean }> {
  if (gestaoCache && Date.now() - gestaoCache.fetchedAt < GESTAO_CACHE_TTL_MS) {
    return { rows: gestaoCache.rows, unavailable: false };
  }
  try {
    const res = await fetch(`${ROBOTIP_API_URL}/api/gestao`, {
      signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`robotip API responded ${res.status}`);
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) throw new Error("unexpected /api/gestao response shape");
    gestaoCache = { rows: rows as GestaoRow[], fetchedAt: Date.now() };
    return { rows: gestaoCache.rows, unavailable: false };
  } catch (err) {
    log.error({ err }, "failed to fetch gestao (curated bankroll ledger) from robotip API");
    return { rows: gestaoCache?.rows ?? [], unavailable: !gestaoCache };
  }
}

/** green: stake × (odd − 1); red: −stake; reembolso: 0 — same convention robotip's own calcPL uses. */
function computeProfit(result: GestaoRow["result"], stakeUnits: number, odd: number | null): number {
  if (result === "green") return odd ? stakeUnits * (odd - 1) : 0;
  if (result === "red") return -stakeUnits;
  return 0;
}

/**
 * robotip's `bot_filter_profiles` table (id 4, name "Evobo") — the curated
 * list of bots this product shows. Queried directly from robotip's Supabase
 * on 2026-07-04; update this list if that profile's bot_names change.
 */
const EVOBO_BOT_NAMES = new Set([
  "OVER 0.5 ESCANTEIOS FT - V6.0",
  "OVER 0.5 ESCANTEIOS FT - V2.0",
  "Bot vencedor 4º lugar na Copa RobôTip #1: Under 2.5 escanteios",
  "OVER 0.5 ESCANTEIOS FT - V7.0",
  "REVALIDAÇÃO OVER 0.5 CORNERS V2.0 (SEM FILTRO DE LIGAS) -- V1.0",
  "REVALIDAÇÃO OVER 0.5 ESCANTEIOS FT V7.0 - (Termos a excluir)",
  "Under 3.5 Corners FT",
]);

const MAX_MERGE_GAP_MS = 3 * 60 * 60 * 1000;

function clusterByTime(rows: Signal[]): Signal[][] {
  const sorted = [...rows].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const clusters: Signal[][] = [];
  for (const row of sorted) {
    const currentCluster = clusters.at(-1);
    const last = currentCluster?.at(-1);
    if (last && row.receivedAt.getTime() - last.receivedAt.getTime() <= MAX_MERGE_GAP_MS) {
      currentCluster!.push(row);
    } else {
      clusters.push([row]);
    }
  }
  return clusters;
}

/** Same fallback the real robotip backend uses when no bet365_url was captured verbatim from the alert text (see robotip/backend/src/services/parser.js). */
function bet365SearchUrl(homeTeam: string | null): string | null {
  if (!homeTeam) return null;
  return `https://www.bet365.bet.br/#/AX/K%5E${encodeURIComponent(homeTeam)}`;
}

function pair(home: number | null, away: number | null) {
  return home === null && away === null ? null : { home, away };
}

/** "1.2-1.4" -> {home: 1.2, away: 1.4} — stored pre-combined by the source system. */
function splitPair(value: string | null) {
  if (!value) return null;
  const [home, away] = value.split("-").map((v) => v.trim());
  return { home: toFiniteNumber(home, null), away: toFiniteNumber(away, null) };
}

export async function robotSignalsRoutes(app: FastifyInstance) {
  // "Robô de Apostas" is a role-gated screen (robo_apostas in the seed) — the
  // frontend hides it from logged-out users, but the backend must enforce
  // that too, not just proxy robotip's (itself unauthenticated) API to anyone.
  app.addHook("preHandler", authGuard);

  app.get<{ Querystring: { result?: string } }>("/", async (request) => {
    // "Alertas" means active signals — resolved (green/red/reembolso) rows
    // are history, not alerts, so default to pending unless a result is
    // explicitly requested (?result=green etc., for future use).
    const result = request.query.result ?? "pending";
    const params = new URLSearchParams({
      bot_names: [...EVOBO_BOT_NAMES].join("|"),
      result,
      limit: "200",
    });

    let rows: Signal[];
    try {
      const res = await fetch(`${ROBOTIP_API_URL}/api/alerts?${params}`, {
        signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`robotip API responded ${res.status}`);
      const body = (await res.json()) as { data: RobotipAlert[] };
      if (!Array.isArray(body?.data)) throw new Error("unexpected /api/alerts response shape");
      rows = body.data.map(fromRobotipAlert);
    } catch (err) {
      request.log.error({ err }, "failed to fetch live alerts from robotip API");
      rows = [];
    }

    const groups = new Map<string, Signal[]>();
    for (const row of rows) {
      const { groupKey } = normalizeMarket(row.botName, row.rawMessage);
      const key = `${row.homeTeam}|${row.awayTeam}|${groupKey}`;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }

    const merged = [...groups.values()].flatMap((groupRows) => clusterByTime(groupRows));

    return merged
      .map((cluster) => {
        // Most recent row in the cluster is the freshest snapshot of the match.
        const latest = cluster.reduce((a, b) => (a.receivedAt > b.receivedAt ? a : b));
        const { label: market, groupKey: marketGroupKey } = normalizeMarket(latest.botName, latest.rawMessage);
        // The design highlights whichever stat the market is actually about
        // (a green full-width row above the rest) — only "Corners" markets
        // map cleanly onto one of our stats today.
        const highlightStat = /corners/i.test(market) ? "corners" : null;

        // Every distinct bot_name that fired this market on this match — the
        // "Gráfico Robô" detail screen is scoped to the normalized market
        // (marketGroupKey), which itself covers every bot_name that maps to
        // that same market across the whole curated ledger, not just these.
        const botNames = [...new Set(cluster.map((row) => row.botName).filter((n): n is string => n !== null))];

        // Suggested stake sums each distinct agreeing bot's own unit (its
        // "Stake: X%" line, defaulting to 1u) — a bot that alone suggests 2u
        // still suggests 2u when it fires alone, and if another bot (1u by
        // default) fires alongside it on the same card, the total is 3u.
        const stakeUnits = botNames.reduce((sum, botName) => {
          const row = cluster.find((r) => r.botName === botName);
          const pct = row?.stakePct ? Number(row.stakePct) : 1;
          return sum + pct;
        }, 0);

        return {
          id: latest.id,
          market,
          marketGroupKey,
          botNames,
          highlightStat,
          stakeUnits,
          homeTeam: latest.homeTeam,
          awayTeam: latest.awayTeam,
          competition: latest.competition,
          scoreHome: latest.scoreHome,
          scoreAway: latest.scoreAway,
          gameMinute: latest.gameMinute,
          lastGoalMinute: latest.lastGoalMinute,
          lastCornerMinute: latest.lastCornerMinute,
          odds: latest.odds,
          result: latest.result,
          receivedAt: latest.receivedAt,
          bet365Url: latest.bet365Url ?? bet365SearchUrl(latest.homeTeam),
          stats: {
            corners: pair(latest.cornersHome, latest.cornersAway),
            dangerousAttacks: pair(latest.dangerousHome, latest.dangerousAway),
            apMin5: splitPair(latest.dangerousPerMin5),
            yellow: pair(latest.yellowHome, latest.yellowAway),
            red: pair(latest.redHome, latest.redAway),
            shotsOff: pair(latest.shotsSideHome, latest.shotsSideAway),
            shotsOn: pair(latest.shotsTargetHome, latest.shotsTargetAway),
            possession:
              latest.possessionHome !== null && latest.possessionAway !== null
                ? { home: Number(latest.possessionHome), away: Number(latest.possessionAway) }
                : null,
          },
        };
      })
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
      .slice(0, 50);
  });

  /**
   * "Desempenho do Robô · 30D" — aggregate green/red/assertividade/ROI across
   * every bot in EVOBO_BOT_NAMES (the same curated set the main `/` route
   * shows), from robotip's curated `gestao_banca` ledger (see fetchGestaoRows
   * above) filtered to the last 30 days.
   */
  app.get("/performance", async (request) => {
    const dateFrom = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const { rows, unavailable } = await fetchGestaoRows(request.log);
    const resolved = rows.filter(
      (r) => EVOBO_BOT_NAMES.has(r.bot_name ?? "") && new Date(r.received_at).getTime() >= dateFrom,
    );

    let cumulative = 0;
    let totalStaked = 0;
    let green = 0;
    let red = 0;
    for (const r of resolved) {
      const stakeUnits = toFiniteNumber(r.stake_pct, 1)!;
      const odd = toFiniteNumber(r.bet_odds, null);
      cumulative += computeProfit(r.result, stakeUnits, odd);
      totalStaked += stakeUnits;
      if (r.result === "green") green++;
      if (r.result === "red") red++;
    }

    return {
      green,
      red,
      assertPct: green + red > 0 ? Math.round((green / (green + red)) * 1000) / 10 : 0,
      roiPct: totalStaked > 0 ? Math.round((cumulative / totalStaked) * 1000) / 10 : 0,
      unavailable,
    };
  });

  /**
   * Shared aggregation core for both the market list and market detail
   * routes below. `sortedRows` must already be filtered to the rows that
   * belong to one market (or, for the summary list, one bucket) and sorted
   * chronologically ascending. Profit per resolved op: green: stake ×
   * (odd − 1); red: −stake; reembolso: 0, accumulated in order. `lucroPct`
   * is the cumulative profit in stake units directly (no bankroll-size
   * denominator) — same convention robotip's own dashboard uses (frontend/
   * src/pages/PerformancePage.jsx: `profit / unitValue`, displayed as-is
   * with a "%" suffix), so this figure matches what the user sees in
   * robotip itself.
   */
  function aggregatePerformance(sortedRows: GestaoRow[]) {
    let cumulative = 0;
    let totalStaked = 0;
    let green = 0;
    let red = 0;
    // avgOdds is over greens only, matching robotip's own avgOdds calc.
    let oddsSum = 0;
    let oddsCount = 0;
    let peak = 0;
    let maxDrawdownPct = 0;
    let curWinLen = 0;
    let curWinProfit = 0;
    let curLoseLen = 0;
    let curLoseProfit = 0;
    let bestRun = { length: 0, profit: 0 };
    let worstRun = { length: 0, profit: 0 };
    const operations = sortedRows.map((r) => {
      const stakeUnits = toFiniteNumber(r.stake_pct, 1)!;
      const odd = toFiniteNumber(r.bet_odds, null);
      const profit = computeProfit(r.result, stakeUnits, odd);
      cumulative += profit;
      totalStaked += stakeUnits;
      if (r.result === "green") {
        green++;
        if (odd) {
          oddsSum += odd;
          oddsCount++;
        }
        curWinLen++;
        curWinProfit += profit;
        curLoseLen = 0;
        curLoseProfit = 0;
      } else if (r.result === "red") {
        red++;
        curLoseLen++;
        curLoseProfit += profit;
        curWinLen = 0;
        curWinProfit = 0;
      } else {
        curWinLen = 0;
        curWinProfit = 0;
        curLoseLen = 0;
        curLoseProfit = 0;
      }
      if (curWinLen > bestRun.length) bestRun = { length: curWinLen, profit: curWinProfit };
      if (curLoseLen > worstRun.length) worstRun = { length: curLoseLen, profit: curLoseProfit };

      // Max drawdown as % of the running peak (peak-to-trough ratio) —
      // matches robotip's own computeDrawdown, not a fixed bankroll size.
      if (cumulative > peak) peak = cumulative;
      const drawdownPct = peak > 0 ? ((peak - cumulative) / peak) * 100 : 0;
      if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;

      return {
        id: r.id,
        date: r.received_at,
        botName: r.bot_name,
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        competition: r.competition,
        result: r.result,
        stakeUnits,
        odds: r.bet_odds,
        cumulativeProfit: Math.round(cumulative * 100) / 100,
      };
    });

    const round2 = (v: number) => Math.round(v * 100) / 100;
    const firstDate = sortedRows[0] ? new Date(sortedRows[0].received_at) : undefined;
    const lastDate = sortedRows.length
      ? new Date(sortedRows[sortedRows.length - 1]!.received_at)
      : undefined;
    const daySpan = firstDate && lastDate
      ? Math.max(1, (lastDate.getTime() - firstDate.getTime()) / 86_400_000)
      : 1;

    return {
      totalOps: operations.length,
      lucroPct: round2(cumulative),
      assertPct: green + red > 0 ? Math.round((green / (green + red)) * 1000) / 10 : 0,
      roiPct: totalStaked > 0 ? Math.round((cumulative / totalStaked) * 1000) / 10 : 0,
      avgOdds: oddsCount > 0 ? round2(oddsSum / oddsCount) : null,
      opsPerDay: operations.length > 0 ? round2(operations.length / daySpan) : 0,
      profitPerOpPct: operations.length > 0 ? round2(cumulative / operations.length) : 0,
      maxDrawdownPct: round2(-maxDrawdownPct),
      bestRun: { length: bestRun.length, profitPct: round2(bestRun.profit) },
      worstRun: { length: worstRun.length, profitPct: round2(worstRun.profit) },
      operations: operations.reverse(), // most recent first, matching the "Operações" list
    };
  }

  /**
   * "Histórico do Robô" — every curated bot grouped by normalized market
   * (same groupKey the live "/" feed merges signals by), so e.g. "OVER 0.5
   * ESCANTEIOS FT - V2.0" and "REVALIDAÇÃO OVER 0.5 CORNERS V2.0 (SEM
   * FILTRO DE LIGAS) -- V1.0" show up as one "Over 0.5 Corners FT" row
   * instead of two unrelated-looking bot names.
   */
  app.get("/markets", async (request) => {
    const { rows, unavailable } = await fetchGestaoRows(request.log);
    const curated = rows.filter((r) => EVOBO_BOT_NAMES.has(r.bot_name ?? ""));

    const groups = new Map<string, { market: string; botNames: Set<string>; rows: GestaoRow[] }>();
    for (const row of curated) {
      const { label, groupKey } = normalizeMarket(row.bot_name);
      let group = groups.get(groupKey);
      if (!group) {
        group = { market: label, botNames: new Set(), rows: [] };
        groups.set(groupKey, group);
      }
      if (row.bot_name) group.botNames.add(row.bot_name);
      group.rows.push(row);
    }

    // Kept array-shaped (unlike /performance and /market/:groupKey) since the
    // frontend consumes this as a plain list — an `unavailable` flag here
    // would need a matching frontend contract change, out of scope for this
    // pass. `unavailable` still short-circuits to an empty list below.
    if (unavailable) return [];

    return [...groups.entries()]
      .map(([groupKey, group]) => {
        const sorted = [...group.rows].sort(
          (a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime(),
        );
        const perf = aggregatePerformance(sorted);
        return {
          groupKey,
          market: group.market,
          botNames: [...group.botNames],
          totalOps: perf.totalOps,
          lucroPct: perf.lucroPct,
          assertPct: perf.assertPct,
          roiPct: perf.roiPct,
          avgOdds: perf.avgOdds,
        };
      })
      .sort((a, b) => b.totalOps - a.totalOps);
  });

  /**
   * "Gráfico Robô" — per-market performance/backtest detail, from robotip's
   * curated `gestao_banca` ledger for every bot_name that normalizes to this
   * market (not one exact bot_name, and not the raw `alerts` firehose —
   * see fetchGestaoRows above for why).
   */
  app.get<{
    Params: { groupKey: string };
    Querystring: { date_from?: string; date_to?: string; odds_min?: string; odds_max?: string };
  }>("/market/:groupKey", async (request) => {
      const groupKey = decodeURIComponent(request.params.groupKey);
      const { rows, unavailable } = await fetchGestaoRows(request.log);

      const dateFrom = request.query.date_from ? new Date(request.query.date_from).getTime() : null;
      const dateTo = request.query.date_to ? new Date(request.query.date_to).getTime() : null;
      const oddsMin = request.query.odds_min ? Number(request.query.odds_min) : null;
      const oddsMax = request.query.odds_max ? Number(request.query.odds_max) : null;

      const matching = rows.filter(
        (r) => EVOBO_BOT_NAMES.has(r.bot_name ?? "") && normalizeMarket(r.bot_name).groupKey === groupKey,
      );
      const market = matching[0] ? normalizeMarket(matching[0].bot_name).label : groupKey;
      const botNames = [...new Set(matching.map((r) => r.bot_name).filter((n): n is string => n !== null))];

      const resolved = matching
        .filter((r) => {
          if (dateFrom === null && dateTo === null) return true;
          const t = new Date(r.received_at).getTime();
          if (dateFrom !== null && t < dateFrom) return false;
          if (dateTo !== null && t > dateTo) return false;
          return true;
        })
        .filter((r) => {
          if (oddsMin === null && oddsMax === null) return true;
          const odd = r.bet_odds ? Number(r.bet_odds) : null;
          if (odd === null) return false;
          if (oddsMin !== null && odd < oddsMin) return false;
          if (oddsMax !== null && odd > oddsMax) return false;
          return true;
        })
        .sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());

      return { groupKey, market, botNames, unavailable, ...aggregatePerformance(resolved) };
  });
}
