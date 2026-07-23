import type { LiveGame } from "./gamesLive";

export type GameStatusFilter = "all" | "scheduled" | "finished";

export type GamesFilterState = {
  date: string; // yyyy-mm-dd
  status: GameStatusFilter;
  minuteMin: number;
  minuteMax: number;
  cornersMarketOnly: boolean;
};

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function defaultGamesFilters(): GamesFilterState {
  return {
    date: toDateInput(new Date()),
    status: "all",
    minuteMin: 0,
    minuteMax: 150,
    cornersMarketOnly: false,
  };
}

export function areFiltersDefault(f: GamesFilterState): boolean {
  const d = defaultGamesFilters();
  return (
    f.status === d.status &&
    f.minuteMin === d.minuteMin &&
    f.minuteMax === d.minuteMax &&
    f.cornersMarketOnly === d.cornersMarketOnly
    // date excluded — it rolls forward daily by design and is also driven by the page's own date tabs.
  );
}

export function applyGamesFilters(games: LiveGame[], f: GamesFilterState): LiveGame[] {
  return games.filter((g) => {
    if (f.status === "scheduled" && g.status === "finished") return false;
    if (f.status === "finished" && g.status !== "finished") return false;
    if (g.minute !== null && (g.minute < f.minuteMin || g.minute > f.minuteMax)) return false;
    if (f.cornersMarketOnly && g.cornersHome === null) return false;
    return true;
  });
}

export type SavedGamesFilter = {
  id: string;
  name: string;
  filters: GamesFilterState;
  savedAt: string;
};

const STORAGE_KEY = "evobo-games-saved-filters";

export function loadSavedGamesFilters(): SavedGamesFilter[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveGamesFilter(name: string, filters: GamesFilterState): SavedGamesFilter[] {
  const next = [
    ...loadSavedGamesFilters(),
    { id: crypto.randomUUID(), name, filters, savedAt: new Date().toISOString() },
  ];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode, quota) — the filter still applies this session, just won't persist.
  }
  return next;
}

export function deleteSavedGamesFilter(id: string): SavedGamesFilter[] {
  const next = loadSavedGamesFilters().filter((f) => f.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
