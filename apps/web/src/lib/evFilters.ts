import type { EvPick } from "./evPlus";

export type EvFilterState = {
  dateFrom: string; // yyyy-mm-dd
  dateTo: string;
  provider: string; // "all" | providerKey(pick)
  side: "all" | "over" | "under";
  market: string; // "all" | pick.marketCategory
  oddMin: number;
  oddMax: number;
  fairMin: number;
  fairMax: number;
  evMin: number;
  evMax: number;
};

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function defaultEvFilters(): EvFilterState {
  const today = new Date();
  const in3Days = new Date(today.getTime() + 3 * 86_400_000);
  return {
    dateFrom: toDateInput(today),
    dateTo: toDateInput(in3Days),
    provider: "all",
    side: "all",
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
    f.provider === d.provider &&
    f.side === d.side &&
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

/** Groups a bookmaker's normal side and its exchange lay side under one provider entry — the modal's "Provedor" filter picks the book, it doesn't distinguish lay. */
export function providerKey(bookie: string | null): string {
  return bookie ? bookie.replace(" (Lay)", "") : "Robotip";
}

export function applyEvFilters(picks: EvPick[], f: EvFilterState): EvPick[] {
  const from = f.dateFrom ? new Date(`${f.dateFrom}T00:00:00`).getTime() : null;
  const to = f.dateTo ? new Date(`${f.dateTo}T23:59:59`).getTime() : null;

  return picks.filter((p) => {
    const ts = new Date(p.kickoff).getTime();
    if (from !== null && ts < from) return false;
    if (to !== null && ts > to) return false;
    if (f.provider !== "all" && providerKey(p.bookie) !== f.provider) return false;
    if (f.side !== "all" && p.side !== f.side) return false;
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
