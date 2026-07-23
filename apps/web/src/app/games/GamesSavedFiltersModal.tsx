import { Modal } from "../../components/Modal";
import { IconX } from "../../components/Icon";
import { deleteSavedGamesFilter, type GamesFilterState, type SavedGamesFilter } from "../../lib/gamesFilters";

type Props = {
  open: boolean;
  onClose: () => void;
  savedFilters: SavedGamesFilter[];
  onApply: (filters: GamesFilterState) => void;
  onDeleted: (next: SavedGamesFilter[]) => void;
};

export function GamesSavedFiltersModal({ open, onClose, savedFilters, onApply, onDeleted }: Props) {
  return (
    <Modal open={open} onClose={onClose} widthClassName="max-w-sm">
      <div className="flex flex-none items-center justify-between gap-3 border-b border-border p-4">
        <div className="text-[15px] font-bold">Filtros avançados salvos</div>
        <button onClick={onClose} aria-label="Fechar" className="text-text-tertiary">
          <IconX size={16} />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {savedFilters.length === 0 && (
          <p className="py-6 text-center text-[13px] text-text-tertiary">Nenhum filtro salvo ainda.</p>
        )}
        {savedFilters.map((f) => (
          <div
            key={f.id}
            className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-chip px-3 py-2.5"
          >
            <button
              onClick={() => {
                onApply(f.filters);
                onClose();
              }}
              className="min-w-0 flex-1 text-left"
            >
              <div className="truncate text-[13px] font-semibold">{f.name}</div>
              <div className="font-mono text-[10px] text-text-tertiary">
                {f.filters.minuteMin}' → {f.filters.minuteMax}'
              </div>
            </button>
            <button
              onClick={() => onDeleted(deleteSavedGamesFilter(f.id))}
              aria-label="Remover filtro salvo"
              className="flex-none text-text-tertiary"
            >
              <IconX size={14} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
