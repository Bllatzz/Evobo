import type { FastifyBaseLogger, FastifyInstance } from "fastify";

/**
 * "Jogos" — live scoreboard read straight from robotip's own public feed
 * (the same one behind https://robotip.com.br/jogosdodia), not the local
 * `games` table (that one's a manually-entered reference list used only to
 * point a tip at a fixture — see modules/games). Unlike EV+'s
 * model_predictions endpoint, everything here works fully anonymously, no
 * session cookie needed.
 *
 * Two upstream calls:
 *  - `next_games` returns every fixture for one calendar day (teams, crests,
 *    league, kickoff, time_status), no score/odds/stats.
 *  - `transfer/StatsFeed?game_id=X` returns one game's current score, 1X2
 *    odds, corners and cards. There's no bulk variant, so a full day means
 *    one request per fixture (~200-350) — fetched with bounded concurrency
 *    and cached for a short window since this is genuinely live data.
 */

const ROBOTIP_PUBLIC_URL = process.env.GAMES_LIVE_ROBOTIP_URL ?? "https://robotip.com.br";
const EXTERNAL_FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 45_000;
const STATS_FETCH_CONCURRENCY = 25;

type NextGameEntry = {
  time_status: number; // 0 not started, 1 live, 2 TBD/postponed, 3 finished
  away_id: string;
  away_name: string;
  home_id: string;
  home_name: string;
  league_country: string | null;
  img_time_1: string;
  img_time_2: string;
  popularity: number;
  nome_liga: string;
  id_liga: string;
  game_id: string;
  time: number; // unix seconds, kickoff
};

type StatsFeedData = {
  goals_home: number | null;
  goals_away: number | null;
  tm: number | null;
  home_win_odd: number | null;
  draw_odd: number | null;
  away_win_odd: number | null;
  corners_home: number | null;
  corners_away: number | null;
  yellowcards_home: number | null;
  yellowcards_away: number | null;
  redcards_home: number | null;
  redcards_away: number | null;
};

export type LiveGame = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeImageUrl: string;
  awayImageUrl: string;
  league: string;
  leagueCountry: string | null;
  kickoff: string; // ISO
  status: "scheduled" | "live" | "finished";
  minute: number | null;
  scoreHome: number | null;
  scoreAway: number | null;
  oddHome: number | null;
  oddDraw: number | null;
  oddAway: number | null;
  cornersHome: number | null;
  cornersAway: number | null;
  yellowHome: number | null;
  yellowAway: number | null;
  redHome: number | null;
  redAway: number | null;
  popularity: number;
};

function statusFromTimeStatus(ts: number): LiveGame["status"] {
  if (ts === 1) return "live";
  if (ts === 3) return "finished";
  return "scheduled"; // 0 (not started) and 2 (TBD/postponed) read the same on this page
}

/** robotip's own "today" in America/Sao_Paulo, matching the timezone its next_games day boundary uses. */
function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function toCustomDateParam(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

async function fetchNextGames(isoDate: string): Promise<Record<string, { last: NextGameEntry }>> {
  const customDate = toCustomDateParam(isoDate);
  const url = `${ROBOTIP_PUBLIC_URL}/api/next_games?timezoneOffset=-10800&pref_lang=pt-BR&customDate=${encodeURIComponent(customDate)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`robotip next_games responded ${res.status}`);
  return (await res.json()) as Record<string, { last: NextGameEntry }>;
}

async function fetchStats(gameId: string): Promise<StatsFeedData | null> {
  try {
    const res = await fetch(`${ROBOTIP_PUBLIC_URL}/api/transfer/StatsFeed?game_id=${gameId}`, {
      signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data: StatsFeedData };
    return body.data;
  } catch {
    return null; // one game's stats failing shouldn't sink the whole day's list
  }
}

/** Runs `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const cache = new Map<string, { games: LiveGame[]; fetchedAt: number }>();

async function loadGames(isoDate: string, log: FastifyBaseLogger): Promise<{ games: LiveGame[]; unavailable: boolean }> {
  const cached = cache.get(isoDate);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { games: cached.games, unavailable: false };
  }

  try {
    const raw = await fetchNextGames(isoDate);
    const entries = Object.values(raw).map((r) => r.last);

    const stats = await mapWithConcurrency(entries, STATS_FETCH_CONCURRENCY, (e) => fetchStats(e.game_id));

    const games: LiveGame[] = entries.map((e, i) => {
      const s = stats[i];
      return {
        gameId: e.game_id,
        homeTeam: e.home_name,
        awayTeam: e.away_name,
        homeImageUrl: e.img_time_1,
        awayImageUrl: e.img_time_2,
        league: e.nome_liga,
        leagueCountry: e.league_country,
        kickoff: new Date(e.time * 1000).toISOString(),
        status: statusFromTimeStatus(e.time_status),
        minute: s?.tm ?? null,
        scoreHome: s?.goals_home ?? null,
        scoreAway: s?.goals_away ?? null,
        oddHome: s?.home_win_odd ?? null,
        oddDraw: s?.draw_odd ?? null,
        oddAway: s?.away_win_odd ?? null,
        cornersHome: s?.corners_home ?? null,
        cornersAway: s?.corners_away ?? null,
        yellowHome: s?.yellowcards_home ?? null,
        yellowAway: s?.yellowcards_away ?? null,
        redHome: s?.redcards_home ?? null,
        redAway: s?.redcards_away ?? null,
        popularity: e.popularity,
      };
    });

    cache.set(isoDate, { games, fetchedAt: Date.now() });
    log.info({ date: isoDate, total: games.length }, "Jogos live feed refreshed");
    return { games, unavailable: false };
  } catch (err) {
    log.error({ err, date: isoDate }, "failed to fetch Jogos live feed from robotip");
    return { games: cached?.games ?? [], unavailable: !cached };
  }
}

export async function gamesLiveRoutes(app: FastifyInstance) {
  // Public read, same as modules/games — this is robotip's own public page data.
  app.get<{ Querystring: { date?: string } }>("/", async (request, reply) => {
    const { date } = request.query;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: "invalid_date" });
    }

    const isoDate = date ?? todayInSaoPaulo();
    const { games, unavailable } = await loadGames(isoDate, request.log);
    return { games, unavailable };
  });
}
