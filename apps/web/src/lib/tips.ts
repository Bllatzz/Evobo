import type { Game, Tip } from "@evobo/shared-types";
import { apiFetch } from "./api";

type AuthorSummary = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verifiedAt: string | null;
};

export type FeedTip = Tip & {
  author: AuthorSummary;
  match: Game;
  _count: { comments: number; takes: number };
  takenByMe: boolean;
};

export type TipDetail = FeedTip & { followedByMe: boolean };

export type FeedComment = {
  id: string;
  tipId: string;
  authorId: string;
  content: string;
  isDeleted: boolean;
  createdAt: string;
  author: AuthorSummary;
};

export const fetchFeed = (): Promise<FeedTip[]> => apiFetch("/tips");

export const fetchTip = (id: string): Promise<TipDetail> => apiFetch(`/tips/${encodeURIComponent(id)}`);

export const takeTip = (id: string) => apiFetch(`/tips/${encodeURIComponent(id)}/take`, { method: "POST" });

export const untakeTip = (id: string) => apiFetch(`/tips/${encodeURIComponent(id)}/take`, { method: "DELETE" });

export const fetchComments = (tipId: string): Promise<FeedComment[]> =>
  apiFetch(`/comments?tipId=${encodeURIComponent(tipId)}`);

export const postComment = (tipId: string, content: string): Promise<FeedComment> =>
  apiFetch(`/comments?tipId=${encodeURIComponent(tipId)}`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });

export const followUser = (userId: string) =>
  apiFetch(`/follows/${encodeURIComponent(userId)}`, { method: "POST" });

export const unfollowUser = (userId: string) =>
  apiFetch(`/follows/${encodeURIComponent(userId)}`, { method: "DELETE" });

export const fetchGames = (
  opts: { q?: string; status?: string; date?: string } = {},
): Promise<Game[]> => {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.status) params.set("status", opts.status);
  if (opts.date) params.set("date", opts.date);
  const qs = params.toString();
  return apiFetch(`/games${qs ? `?${qs}` : ""}`);
};

export const createTip = (input: {
  matchId: string;
  market: string;
  odds: number;
  stakeUnits: number;
  house: string;
  confidence?: "baixa" | "media" | "alta";
  analysisText?: string;
  visibility: "public" | "vip_only";
}): Promise<FeedTip> => apiFetch("/tips", { method: "POST", body: JSON.stringify(input) });
