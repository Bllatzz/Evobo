/**
 * Low-level client for robotip's public feed (the same one behind
 * https://robotip.com.br/jogosdodia) — shared by routes.ts (today's
 * scoreboard) and teamForm.ts (scanning past days for a team's last
 * results). Fully anonymous, no session cookie needed.
 */

export const ROBOTIP_PUBLIC_URL = process.env.GAMES_LIVE_ROBOTIP_URL ?? "https://robotip.com.br";
export const EXTERNAL_FETCH_TIMEOUT_MS = 10_000;

export type NextGameEntry = {
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

export type StatsFeedData = {
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

export function toCustomDateParam(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

export async function fetchNextGames(isoDate: string): Promise<Record<string, { last: NextGameEntry }>> {
  const customDate = toCustomDateParam(isoDate);
  const url = `${ROBOTIP_PUBLIC_URL}/api/next_games?timezoneOffset=-10800&pref_lang=pt-BR&customDate=${encodeURIComponent(customDate)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`robotip next_games responded ${res.status}`);
  return (await res.json()) as Record<string, { last: NextGameEntry }>;
}

export async function fetchStats(gameId: string): Promise<StatsFeedData | null> {
  try {
    const res = await fetch(`${ROBOTIP_PUBLIC_URL}/api/transfer/StatsFeed?game_id=${gameId}`, {
      signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data: StatsFeedData };
    return body.data;
  } catch {
    return null; // one game's stats failing shouldn't sink the whole batch
  }
}

/** Runs `fn` over `items` with at most `limit` in flight at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
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
