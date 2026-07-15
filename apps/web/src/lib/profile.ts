import type { Game, Tip, User } from "@evobo/shared-types";
import { apiFetch } from "./api";
import { supabase } from "./supabase";

export type ProfileDetail = User & {
  role: string;
  followers: number;
  following: number;
  followedByMe: boolean;
  tipsCount: number;
  greenCount: number;
  redCount: number;
  roi: number;
  hitRate: number;
};

export type ProfileTip = Tip & { match: Game };

export const fetchProfile = (username: string): Promise<ProfileDetail> =>
  apiFetch(`/users/${encodeURIComponent(username)}`);

export const fetchProfileTips = (username: string): Promise<ProfileTip[]> =>
  apiFetch(`/users/${encodeURIComponent(username)}/tips`);

export const fetchMyBets = (): Promise<ProfileTip[]> => apiFetch("/users/me/bets");

export const updateMyProfile = (input: {
  bio?: string | null;
  displayName?: string;
  username?: string;
  avatarUrl?: string | null;
  favoriteSports?: string[];
}) => apiFetch("/users/me", { method: "PATCH", body: JSON.stringify(input) });

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
// SVG deliberately excluded — it can embed <script>, and a public bucket
// serving it as image/svg+xml would execute that script if opened directly
// (outside an <img> tag) on the Supabase Storage origin.
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Uploads to the user's own folder in the `avatars` bucket (storage RLS only allows writes there) and returns the public URL. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  // `file.type` is client-reported and this is a UX check, not a security
  // boundary — the storage bucket's own config must enforce this too.
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    throw new Error("invalid_avatar_type");
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error("avatar_too_large");
  }

  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;

  return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}
