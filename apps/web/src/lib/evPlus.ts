import { apiFetch } from "./api";

export type EvPick = {
  id: number;
  gameId: string;
  market: string;
  marketCategory: string;
  side: "over" | "under";
  bookie: string | null;
  evPct: number;
  oddBookie: number;
  oddFair: number;
  probFairPct: number;
  homeTeam: string;
  awayTeam: string;
  homeImageUrl: string;
  awayImageUrl: string;
  competition: string | null;
  kickoff: string;
  status: "live" | "upcoming" | "finished";
  analysis: string | null;
};

export type EvPicksResponse = {
  picks: EvPick[];
  unavailable: boolean;
};

export const fetchEvPicks = (history = false): Promise<EvPicksResponse> =>
  apiFetch(history ? "/ev-plus?history=1" : "/ev-plus");
