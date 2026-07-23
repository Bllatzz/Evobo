import { useEffect, useState, type MouseEvent } from "react";
import { DualRangeSlider } from "../../components/DualRangeSlider";
import { Toggle } from "../../components/Toggle";
import { IconTune, IconX, IconCheck, IconArrowUp } from "../../components/Icon";
import { defaultGamesFilters, saveGamesFilter, type GamesFilterState, type GameStatusFilter } from "../../lib/gamesFilters";

type Props = {
  open: boolean;
  onClose: () => void;
  filters: GamesFilterState;
  onApply: (filters: GamesFilterState) => void;
  onOpenSavedFilters: () => void;
  onFilterSaved: () => void;
};

const STATUS_OPTIONS: { key: GameStatusFilter; label: string }[] = [
  { key: "scheduled", label: "Agendados" },
  { key: "finished", label: "Finalizados" },
];

/** Right-side drawer on desktop, bottom sheet on mobile — same shell as EvFilterModal. */
export function GamesFilterModal({ open, onClose, filters, onApply, onOpenSavedFilters, onFilterSaved }: Props) {
  const [draft, setDraft] = useState(filters);
  const [saveName, setSaveName] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function onBackdropClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  function set<K extends keyof GamesFilterState>(key: K, value: GamesFilterState[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleStatus(key: GameStatusFilter) {
    set("status", draft.status === key ? "all" : key);
  }

  function handleApply() {
    onApply(draft);
    onClose();
  }

  function handleSave() {
    const name = saveName.trim();
    if (!name) return;
    saveGamesFilter(name, draft);
    setSaveName("");
    onFilterSaved();
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1600);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onBackdropClick}>
      <div
        className={`fixed inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-3xl border-t border-border bg-surface-alt transition-transform duration-300 ease-out lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-full lg:max-w-md lg:rounded-t-none lg:rounded-l-3xl lg:border-l lg:border-t-0 ${
          entered ? "translate-y-0 lg:translate-x-0" : "translate-y-full lg:translate-x-full lg:translate-y-0"
        }`}
      >
        <div className="flex justify-center pb-2 pt-2.5 lg:hidden">
          <div className="h-1 w-9 rounded-full bg-border-strong" />
        </div>

        <div className="flex flex-none items-start justify-between gap-3 border-b border-border p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-surface-chip">
              <IconTune size={16} className="text-text-secondary" />
            </div>
            <div>
              <div className="text-[15px] font-bold">Filtrar por</div>
              <div className="text-[12px] text-text-tertiary">Escolha um filtro para aplicar</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="flex-none text-text-tertiary">
            <IconX size={16} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
          <div>
            <div className="mb-2 text-[13px] font-semibold">Status</div>
            <div className="flex gap-2.5">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => toggleStatus(opt.key)}
                  className={`flex-1 rounded-xl py-2.5 text-[13px] font-semibold ${
                    draft.status === opt.key
                      ? "bg-accent text-[#08090A]"
                      : "bg-surface-chip text-text-secondary"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold">Data</span>
            <input
              type="date"
              value={draft.date}
              onChange={(e) => set("date", e.target.value)}
              className="w-full rounded-lg border border-border-strong bg-surface-alt px-2.5 py-2 font-mono text-[12px] text-text outline-none"
            />
          </label>

          <div>
            <div className="mb-2 text-[13px] font-semibold">Tempo de jogo</div>
            <DualRangeSlider
              min={0}
              max={150}
              step={1}
              value={[draft.minuteMin, draft.minuteMax]}
              onChange={([lo, hi]) => setDraft((d) => ({ ...d, minuteMin: lo, minuteMax: hi }))}
              formatValue={(v) => String(v)}
            />
          </div>

          <label className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold">Mercado de escanteios</div>
              <div className="text-[11px] text-text-tertiary">Só jogos com estatística de escanteios</div>
            </div>
            <Toggle on={draft.cornersMarketOnly} onChange={() => set("cornersMarketOnly", !draft.cornersMarketOnly)} />
          </label>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="font-mono text-[11px] text-text-tertiary">OU</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div>
            <div className="mb-2.5 text-[13px] font-semibold">Filtros avançados</div>
            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => {
                  onClose();
                  onOpenSavedFilters();
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-full border border-border-strong bg-surface-chip py-2.5 text-[13px] font-semibold text-text-secondary"
              >
                <IconArrowUp size={13} />
                Carregar filtro avançado
              </button>
              <button
                onClick={() => setDraft(defaultGamesFilters())}
                className="flex w-full items-center justify-center gap-1.5 rounded-full border border-border-strong bg-surface-chip py-2.5 text-[13px] font-semibold text-text-secondary"
              >
                <IconX size={13} />
                Remover filtros avançados
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-none flex-col gap-3 border-t border-border p-4">
          <div className="flex gap-2">
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Nome do filtro"
              className="flex-1 rounded-lg border border-border-strong bg-surface-alt px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-tertiary"
            />
            <button
              onClick={handleSave}
              disabled={!saveName.trim()}
              className="flex flex-none items-center gap-1.5 rounded-lg border border-border-strong bg-surface-chip px-3 py-2 text-[12px] font-semibold text-text-secondary disabled:opacity-40"
            >
              {savedFlash ? <IconCheck size={13} className="text-accent" /> : "Salvar filtro"}
            </button>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-full border border-border-strong py-2.5 text-[13px] font-semibold text-text-secondary"
            >
              Cancelar
            </button>
            <button
              onClick={handleApply}
              className="flex-1 rounded-full bg-accent py-2.5 text-[13px] font-bold text-[#08090A]"
            >
              Aplicar filtro
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
