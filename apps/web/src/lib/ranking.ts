import { apiFetch } from "./api";

export type RankedTipster = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verifiedAt: string | null;
  followers: number;
  tipsCount: number;
  greenCount: number;
  redCount: number;
  roi: number;
  hitRate: number;
};

export const fetchRanking = (sort: "roi" | "hitrate" = "roi"): Promise<RankedTipster[]> =>
  apiFetch(`/ranking?sort=${sort}`);
