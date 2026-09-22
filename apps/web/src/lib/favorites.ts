import type { AddFavoriteInput, FavoriteKind } from "@evobo/shared-types";
import { apiFetch } from "./api";

/** A starred team/league — `externalId` is robotip's own id, see UserFavorite on the API. */
export type Favorite = {
  kind: FavoriteKind;
  externalId: string;
  name: string;
  imageUrl: string | null;
  createdAt: string;
};

export const fetchFavorites = (): Promise<Favorite[]> => apiFetch("/favorites");

export const addFavorite = (input: AddFavoriteInput): Promise<null> =>
  apiFetch("/favorites", { method: "POST", body: JSON.stringify(input) });

export const removeFavorite = (kind: FavoriteKind, externalId: string): Promise<null> =>
  apiFetch(`/favorites/${kind}/${encodeURIComponent(externalId)}`, { method: "DELETE" });

export const favoriteKey = (kind: FavoriteKind, externalId: string) => `${kind}:${externalId}`;
