import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { resolveLeagueImageUrl } from "./leagueImages.js";
import { fetchNextGames, fetchStats, mapWithConcurrency } from "./robotipClient.js";
import { fetchTeamForm } from "./teamForm.js";

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

const CACHE_TTL_MS = 45_000;
const STATS_FETCH_CONCURRENCY = 25;

export type LiveGame = {
  gameId: string;
  homeId: string;
  awayId: string;
  homeTeam: string;
  awayTeam: string;
  homeImageUrl: string;
  awayImageUrl: string;
  league: string;
  leagueCountry: string | null;
  leagueImageUrl: string;
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

/** YYYY-MM-DD that is also a real calendar day — the format regex alone lets
 * "2026-13-45" through, which would reach robotip as a bogus lookup. */
function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// This endpoint is public and takes any date, so cap how many days stay in
// memory — otherwise a caller walking through dates grows the Map forever.
const MAX_CACHED_DATES = 60;
const cache = new Map<string, { games: LiveGame[]; fetchedAt: number }>();

function rememberDate(isoDate: string, games: LiveGame[]) {
  failedAt.delete(isoDate);
  cache.delete(isoDate); // re-insert so a refreshed date counts as the newest
  cache.set(isoDate, { games, fetchedAt: Date.now() });
  while (cache.size > MAX_CACHED_DATES) {
    cache.delete(cache.keys().next().value!); // Map iterates oldest-first
  }
}

type LoadedGames = { games: LiveGame[]; unavailable: boolean };

// While robotip is down, every request used to wait out its own timeout and
// refetch every game's stats. Concurrent callers for the same date now share
// one fetch, and after a failure that date serves its stale copy for a while
// instead of retrying. Tracked per date (and capped like `cache`) so a bad
// date can't block the good ones.
const FAILURE_BACKOFF_MS = 30_000;
const inFlight = new Map<string, Promise<LoadedGames>>();
const failedAt = new Map<string, number>();

function rememberFailure(isoDate: string) {
  failedAt.delete(isoDate);
  failedAt.set(isoDate, Date.now());
  while (failedAt.size > MAX_CACHED_DATES) {
    failedAt.delete(failedAt.keys().next().value!);
  }
}

async function loadGames(isoDate: string, log: FastifyBaseLogger): Promise<LoadedGames> {
  const cached = cache.get(isoDate);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { games: cached.games, unavailable: false };
  }
  const lastFailure = failedAt.get(isoDate);
  if (lastFailure !== undefined && Date.now() - lastFailure < FAILURE_BACKOFF_MS) {
    return { games: cached?.games ?? [], unavailable: !cached };
  }

  let pending = inFlight.get(isoDate);
  if (!pending) {
    pending = refreshGames(isoDate, log).finally(() => inFlight.delete(isoDate));
    inFlight.set(isoDate, pending);
  }
  return pending;
}

async function refreshGames(isoDate: string, log: FastifyBaseLogger): Promise<LoadedGames> {
  const cached = cache.get(isoDate);

  try {
    const raw = await fetchNextGames(isoDate);
    const entries = Object.values(raw).map((r) => r.last);

    const stats = await mapWithConcurrency(entries, STATS_FETCH_CONCURRENCY, (e) => fetchStats(e.game_id));

    // One flag/logo lookup per distinct league in the day's list, not per game.
    const leagueIds = [...new Set(entries.map((e) => e.id_liga))];
    const leagueImageById = new Map(
      await mapWithConcurrency(leagueIds, STATS_FETCH_CONCURRENCY, async (id) => {
        const entry = entries.find((e) => e.id_liga === id)!;
        return [id, await resolveLeagueImageUrl(entry.league_country, id)] as const;
      }),
    );

    const games: LiveGame[] = entries.map((e, i) => {
      const s = stats[i];
      return {
        gameId: e.game_id,
        homeId: e.home_id,
        awayId: e.away_id,
        homeTeam: e.home_name,
        awayTeam: e.away_name,
        homeImageUrl: e.img_time_1,
        awayImageUrl: e.img_time_2,
        league: e.nome_liga,
        leagueCountry: e.league_country,
        leagueImageUrl: leagueImageById.get(e.id_liga)!,
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

    rememberDate(isoDate, games);
    log.info({ date: isoDate, total: games.length }, "Jogos live feed refreshed");
    return { games, unavailable: false };
  } catch (err) {
    log.error({ err, date: isoDate }, "failed to fetch Jogos live feed from robotip");
    rememberFailure(isoDate);
    return { games: cached?.games ?? [], unavailable: !cached };
  }
}

export async function gamesLiveRoutes(app: FastifyInstance) {
  // Public read, same as modules/games — this is robotip's own public page data.
  app.get<{ Querystring: { date?: string } }>("/", async (request, reply) => {
    const { date } = request.query;
    if (date && !isRealIsoDate(date)) {
      return reply.code(400).send({ error: "invalid_date" });
    }

    const isoDate = date ?? todayInSaoPaulo();
    const { games, unavailable } = await loadGames(isoDate, request.log);
    return { games, unavailable };
  });

  // Single-fixture detail — backs the "Jogo" stats page. `date` must match
  // the day the fixture was listed under on `/` (there's no per-gameId
  // lookup upstream), so the frontend always passes along the date it
  // fetched the game from.
  app.get<{ Params: { gameId: string }; Querystring: { date?: string } }>(
    "/:gameId",
    async (request, reply) => {
      const { gameId } = request.params;
      const { date } = request.query;
      if (date && !isRealIsoDate(date)) {
        return reply.code(400).send({ error: "invalid_date" });
      }

      const isoDate = date ?? todayInSaoPaulo();
      const { games } = await loadGames(isoDate, request.log);
      const game = games.find((g) => g.gameId === gameId);
      if (!game) return reply.code(404).send({ error: "not_found" });

      const [homeForm, awayForm] = await Promise.all([
        fetchTeamForm(game.homeId).catch(() => []),
        fetchTeamForm(game.awayId).catch(() => []),
      ]);

      return { game, homeForm, awayForm };
    },
  );
}
