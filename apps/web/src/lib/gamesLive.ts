import { apiFetch } from "./api";

/** One fixture from robotip's own public jogosdodia feed — see apps/api/src/modules/games-live. */
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

/** One past result for a team, oldest → newest — see teamForm.ts on the API. */
export type TeamFormEntry = {
  gameId: string;
  opponent: string;
  isHome: boolean;
  scoreFor: number;
  scoreAgainst: number;
  result: "W" | "D" | "L";
  kickoff: string;
  league: string;
};

export type GameDetail = {
  game: LiveGame;
  homeForm: TeamFormEntry[];
  awayForm: TeamFormEntry[];
};

export const fetchGameDetail = (gameId: string, date: string): Promise<GameDetail> =>
  apiFetch(`/games-live/${gameId}?date=${date}`);
