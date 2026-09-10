import { fetchNextGames, fetchStats, mapWithConcurrency, type NextGameEntry } from "./robotipClient.js";

export type TeamFormEntry = {
  gameId: string;
  opponent: string;
  isHome: boolean;
  scoreFor: number;
  scoreAgainst: number;
  result: "W" | "D" | "L";
  kickoff: string; // ISO
  league: string;
};

const FORM_MATCHES = 5;
// Bounds a cold scan for a team that plays rarely (international breaks,
// lower leagues, cup-only sides) — beyond this we just show fewer than 5.
const MAX_DAYS_BACK = 45;
const FORM_SCAN_CONCURRENCY = 8;
// Candidate days are fetched concurrently rather than walked one at a time —
// a team with no match in the last couple weeks would otherwise mean up to
// MAX_DAYS_BACK sequential upstream round trips (~50s observed) before the
// scan gives up.
const DAY_FETCH_CONCURRENCY = 10;

// Raw day lookups are cached for hours, not the 45s the live scoreboard
// uses — a past day's results never change, and this cache is what keeps a
// cold form scan (up to MAX_DAYS_BACK requests) from repeating on every hit.
const DAY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const dayCache = new Map<string, { entries: NextGameEntry[]; fetchedAt: number }>();

async function loadDayEntries(isoDate: string): Promise<NextGameEntry[]> {
  const cached = dayCache.get(isoDate);
  if (cached && Date.now() - cached.fetchedAt < DAY_CACHE_TTL_MS) return cached.entries;
  const raw = await fetchNextGames(isoDate);
  const entries = Object.values(raw).map((r) => r.last);
  dayCache.set(isoDate, { entries, fetchedAt: Date.now() });
  return entries;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const FORM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const formCache = new Map<string, { entries: TeamFormEntry[]; fetchedAt: number }>();

/**
 * "Last 5 results" for a team. robotip has no per-team history endpoint, so
 * this walks backward day-by-day through the same public next_games feed
 * the live scoreboard uses, collecting finished matches that involve
 * teamId, until 5 turn up (or MAX_DAYS_BACK is exhausted). Results are
 * ordered oldest → newest, matching how a "form" strip usually reads.
 */
export async function fetchTeamForm(teamId: string): Promise<TeamFormEntry[]> {
  const cached = formCache.get(teamId);
  if (cached && Date.now() - cached.fetchedAt < FORM_CACHE_TTL_MS) return cached.entries;

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const candidateDates = Array.from({ length: MAX_DAYS_BACK }, (_, i) => addDaysIso(today, -(i + 1)));
  const daysEntries = await mapWithConcurrency(candidateDates, DAY_FETCH_CONCURRENCY, async (isoDate) => {
    try {
      return await loadDayEntries(isoDate);
    } catch {
      return []; // one bad day shouldn't abort the whole scan
    }
  });

  const found: TeamFormEntry[] = [];

  for (let d = 0; d < candidateDates.length && found.length < FORM_MATCHES; d++) {
    const matches = daysEntries[d]!
      .filter((e) => e.time_status === 3 && (e.home_id === teamId || e.away_id === teamId))
      .sort((a, b) => b.time - a.time);
    if (matches.length === 0) continue;

    const stats = await mapWithConcurrency(matches, FORM_SCAN_CONCURRENCY, (m) => fetchStats(m.game_id));

    for (let j = 0; j < matches.length && found.length < FORM_MATCHES; j++) {
      const m = matches[j]!;
      const s = stats[j];
      if (!s || s.goals_home == null || s.goals_away == null) continue;

      const isHome = m.home_id === teamId;
      const scoreFor = isHome ? s.goals_home : s.goals_away;
      const scoreAgainst = isHome ? s.goals_away : s.goals_home;
      found.push({
        gameId: m.game_id,
        opponent: isHome ? m.away_name : m.home_name,
        isHome,
        scoreFor,
        scoreAgainst,
        result: scoreFor > scoreAgainst ? "W" : scoreFor < scoreAgainst ? "L" : "D",
        kickoff: new Date(m.time * 1000).toISOString(),
        league: m.nome_liga,
      });
    }
  }

  const entries = found.reverse(); // was newest→oldest as collected, flip to oldest→newest
  formCache.set(teamId, { entries, fetchedAt: Date.now() });
  return entries;
}
