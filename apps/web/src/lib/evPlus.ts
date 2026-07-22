import { apiFetch } from "./api";

export type EvPick = {
  id: number;
  market: string;
  bookie: string | null;
  evPct: number;
  oddBookie: number;
  oddFair: number;
  homeTeam: string;
  awayTeam: string;
  homeImageUrl: string;
  awayImageUrl: string;
  competition: string | null;
  kickoff: string;
  analysis: string | null;
};

export type EvPicksResponse = {
  picks: EvPick[];
  unavailable: boolean;
};

export const fetchEvPicks = (): Promise<EvPicksResponse> => apiFetch("/ev-plus");
