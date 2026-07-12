import type { Game } from "@evobo/shared-types";
import { apiFetch } from "./api";
import type { FeedTip } from "./tips";

export type SearchTipster = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verifiedAt: string | null;
  followers: number;
};

export type SearchResults = {
  tipsters: SearchTipster[];
  games: Game[];
  tips: FeedTip[];
};

export const search = (q: string): Promise<SearchResults> =>
  apiFetch(`/search?q=${encodeURIComponent(q)}`);
