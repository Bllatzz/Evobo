import { apiFetch } from "./api";

/** One fixture from robotip's own public jogosdodia feed — see apps/api/src/modules/games-live. */
export type LiveGame = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeImageUrl: string;
  awayImageUrl: string;
  league: string;
  leagueCountry: string | null;
  kickoff: string;
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

export type LiveGamesResponse = {
  games: LiveGame[];
  unavailable: boolean;
};

export const fetchLiveGames = (date: string): Promise<LiveGamesResponse> =>
  apiFetch(`/games-live?date=${date}`);
