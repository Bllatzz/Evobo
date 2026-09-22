import type { FavoriteKind } from "@evobo/shared-types";
import { useAuth } from "../stores/auth";
import { useFavorites } from "../stores/favorites";
import { IconStar } from "./Icon";

type Props = {
  kind: FavoriteKind;
  externalId: string;
  name: string;
  imageUrl: string | null;
  size?: number;
  className?: string;
};

/** Star toggle for a team/league. Renders nothing when logged out — favorites are per-user. */
export function FavoriteStar({ kind, externalId, name, imageUrl, size = 15, className = "" }: Props) {
  const { me } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites();
  if (!me) return null;

  const active = isFavorite(kind, externalId);
  const label = `${active ? "Remover" : "Adicionar"} ${name} ${active ? "dos" : "aos"} favoritos`;

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={(e) => {
        // Stars sit inside game/league links — starring shouldn't navigate.
        e.preventDefault();
        e.stopPropagation();
        void toggleFavorite({ kind, externalId, name, imageUrl });
      }}
      className={`flex flex-none items-center justify-center rounded-full p-1 transition-colors ${
        active ? "text-accent" : "text-text-quaternary hover:text-text-secondary"
      } ${className}`}
    >
      <IconStar size={size} filled={active} />
    </button>
  );
}
