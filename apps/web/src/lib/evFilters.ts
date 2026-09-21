import type { EvPick } from "./evPlus";
import { addDaysIso, todayIsoSaoPaulo } from "./dates";

export type EvFilterState = {
  dateFrom: string; // yyyy-mm-dd
  dateTo: string;
  market: string; // "all" | pick.marketCategory
  oddMin: number;
  oddMax: number;
  fairMin: number;
  fairMax: number;
  evMin: number;
  evMax: number;
};

// Matches the two robotip fetch windows in apps/api's ev-plus route: 7 days back
// (finished games) through 3 days ahead (live/upcoming) — a tighter default would
// silently exclude picks the page actually has data for. "Today" is São Paulo's
// (lib/dates.ts): the UTC date is already tomorrow after ~21h in Brazil, which
// used to push the whole window a day forward and hide the oldest day of picks.
export function defaultEvFilters(): EvFilterState {
  const today = todayIsoSaoPaulo();
  return {
    dateFrom: addDaysIso(today, -7),
    dateTo: addDaysIso(today, 3),
    market: "all",
    oddMin: 1,
    oddMax: 30,
    fairMin: 1,
    fairMax: 30,
    evMin: -100,
    evMax: 100,
  };
}

export function areFiltersDefault(f: EvFilterState): boolean {
  const d = defaultEvFilters();
  return (
    f.market === d.market &&
    f.oddMin === d.oddMin &&
    f.oddMax === d.oddMax &&
    f.fairMin === d.fairMin &&
    f.fairMax === d.fairMax &&
    f.evMin === d.evMin &&
    f.evMax === d.evMax
    // dateFrom/dateTo excluded — they roll forward daily by design, so they
    // shouldn't count toward "user changed something" on their own.
  );
}

export function applyEvFilters(picks: EvPick[], f: EvFilterState): EvPick[] {
  const from = f.dateFrom ? new Date(`${f.dateFrom}T00:00:00`).getTime() : null;
  const to = f.dateTo ? new Date(`${f.dateTo}T23:59:59`).getTime() : null;

  return picks.filter((p) => {
    const ts = new Date(p.kickoff).getTime();
    if (from !== null && ts < from) return false;
    if (to !== null && ts > to) return false;
    if (f.market !== "all" && p.marketCategory !== f.market) return false;
    if (p.oddBookie < f.oddMin || p.oddBookie > f.oddMax) return false;
    if (p.oddFair < f.fairMin || p.oddFair > f.fairMax) return false;
    if (p.evPct < f.evMin || p.evPct > f.evMax) return false;
    return true;
  });
}

export type SavedEvFilter = {
  id: string;
  name: string;
  filters: EvFilterState;
  savedAt: string;
};

const STORAGE_KEY = "evobo-ev-saved-filters";

export function loadSavedEvFilters(): SavedEvFilter[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveEvFilter(name: string, filters: EvFilterState): SavedEvFilter[] {
  const next = [
    ...loadSavedEvFilters(),
    { id: crypto.randomUUID(), name, filters, savedAt: new Date().toISOString() },
  ];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode, quota) — the filter still applies this session, just won't persist.
  }
  return next;
}

export function deleteSavedEvFilter(id: string): SavedEvFilter[] {
  const next = loadSavedEvFilters().filter((f) => f.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
