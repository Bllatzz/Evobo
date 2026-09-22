import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FavoriteKind } from "@evobo/shared-types";
import { useAuth } from "./auth";
import { addFavorite, favoriteKey, fetchFavorites, removeFavorite, type Favorite } from "../lib/favorites";

type ToggleTarget = { kind: FavoriteKind; externalId: string; name: string; imageUrl: string | null };

type FavoritesContextValue = {
  favorites: Favorite[];
  isFavorite: (kind: FavoriteKind, externalId: string) => boolean;
  /** Optimistic — flips immediately and rolls back if the request fails. */
  toggleFavorite: (target: ToggleTarget) => Promise<void>;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const userId = useAuth().me?.id;
  const [favorites, setFavorites] = useState<Favorite[]>([]);

  useEffect(() => {
    if (!userId) {
      setFavorites([]);
      return;
    }
    let cancelled = false;
    fetchFavorites()
      .then((list) => {
        if (!cancelled) setFavorites(list);
      })
      .catch(() => {
        // Stars just render as unset — nothing else on the page depends on this.
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const keys = useMemo(() => new Set(favorites.map((f) => favoriteKey(f.kind, f.externalId))), [favorites]);

  const isFavorite = useCallback(
    (kind: FavoriteKind, externalId: string) => keys.has(favoriteKey(kind, externalId)),
    [keys],
  );

  const toggleFavorite = useCallback(
    async (target: ToggleTarget) => {
      const key = favoriteKey(target.kind, target.externalId);
      const wasFavorite = keys.has(key);
      const snapshot = favorites;

      setFavorites((prev) =>
        wasFavorite
          ? prev.filter((f) => favoriteKey(f.kind, f.externalId) !== key)
          : [...prev, { ...target, createdAt: new Date().toISOString() }],
      );

      try {
        if (wasFavorite) await removeFavorite(target.kind, target.externalId);
        else await addFavorite(target);
      } catch {
        setFavorites(snapshot);
      }
    },
    [favorites, keys],
  );

  const value = useMemo(() => ({ favorites, isFavorite, toggleFavorite }), [favorites, isFavorite, toggleFavorite]);

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used within FavoritesProvider");
  return ctx;
}
