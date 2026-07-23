import { useEffect, useState, type MouseEvent } from "react";
import { DualRangeSlider } from "../../components/DualRangeSlider";
import { IconTune, IconX, IconCheck, IconArrowUp } from "../../components/Icon";
import { defaultEvFilters, saveEvFilter, type EvFilterState } from "../../lib/evFilters";

type Props = {
  open: boolean;
  onClose: () => void;
  filters: EvFilterState;
  onApply: (filters: EvFilterState) => void;
  providers: string[];
  marketCategories: string[];
  onOpenSavedFilters: () => void;
  onFilterSaved: () => void;
};

/**
 * A right-side drawer on desktop, a bottom sheet on mobile — matches the
 * design reference exactly (the table/list stays visible, dimmed, behind
 * it; this never covers the whole viewport like a centered dialog would).
 */
export function EvFilterModal({
  open,
  onClose,
  filters,
  onApply,
  providers,
  marketCategories,
  onOpenSavedFilters,
  onFilterSaved,
}: Props) {
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

  function set<K extends keyof EvFilterState>(key: K, value: EvFilterState[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handleApply() {
    onApply(draft);
    onClose();
  }

  function handleSave() {
    const name = saveName.trim();
    if (!name) return;
    saveEvFilter(name, draft);
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
            <div className="mb-2 text-[13px] font-semibold">Data</div>
            <div className="flex gap-3">
              <label className="flex-1">
                <span className="mb-1 block text-[11px] text-text-secondary">De</span>
                <input
                  type="date"
                  value={draft.dateFrom}
                  onChange={(e) => set("dateFrom", e.target.value)}
                  className="w-full rounded-lg border border-border-strong bg-surface-alt px-2.5 py-2 font-mono text-[12px] text-text outline-none"
                />
              </label>
              <label className="flex-1">
                <span className="mb-1 block text-[11px] text-text-secondary">Até</span>
                <input
                  type="date"
                  value={draft.dateTo}
                  onChange={(e) => set("dateTo", e.target.value)}
                  className="w-full rounded-lg border border-border-strong bg-surface-alt px-2.5 py-2 font-mono text-[12px] text-text outline-none"
                />
              </label>
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-[13px] font-semibold">Provedor</span>
            <select
              value={draft.provider}
              onChange={(e) => set("provider", e.target.value)}
              className="w-full rounded-lg border border-border-strong bg-surface-alt px-3 py-2 text-[13px] text-text"
            >
              <option value="all">Selecionar</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-[13px] font-semibold">Lado</span>
            <select
              value={draft.side}
              onChange={(e) => set("side", e.target.value as EvFilterState["side"])}
              className="w-full rounded-lg border border-border-strong bg-surface-alt px-3 py-2 text-[13px] text-text"
            >
              <option value="all">Selecionar</option>
              <option value="over">Mais de</option>
              <option value="under">Menos de</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-[13px] font-semibold">Mercado</span>
            <select
              value={draft.market}
              onChange={(e) => set("market", e.target.value)}
              className="w-full rounded-lg border border-border-strong bg-surface-alt px-3 py-2 text-[13px] text-text"
            >
              <option value="all">Selecionar</option>
              {marketCategories.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">Odd mercado</div>
            <DualRangeSlider
              min={1}
              max={30}
              step={0.05}
              value={[draft.oddMin, draft.oddMax]}
              onChange={([lo, hi]) => setDraft((d) => ({ ...d, oddMin: lo, oddMax: hi }))}
              formatValue={(v) => v.toFixed(1)}
            />
          </div>

          <div>
            <div className="mb-2 text-[13px] font-semibold">Odd justa</div>
            <DualRangeSlider
              min={1}
              max={30}
              step={0.05}
              value={[draft.fairMin, draft.fairMax]}
              onChange={([lo, hi]) => setDraft((d) => ({ ...d, fairMin: lo, fairMax: hi }))}
              formatValue={(v) => v.toFixed(1)}
            />
          </div>

          <div>
            <div className="mb-2 text-[13px] font-semibold">EV</div>
            <DualRangeSlider
              min={-100}
              max={100}
              step={1}
              value={[draft.evMin, draft.evMax]}
              onChange={([lo, hi]) => setDraft((d) => ({ ...d, evMin: lo, evMax: hi }))}
              formatValue={(v) => `${v}%`}
            />
          </div>

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
                Carregar filtro salvo
              </button>
              <button
                onClick={() => setDraft(defaultEvFilters())}
                className="flex w-full items-center justify-center gap-1.5 rounded-full border border-border-strong bg-surface-chip py-2.5 text-[13px] font-semibold text-text-secondary"
              >
                <IconX size={13} />
                Limpar filtros
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

          <button
            onClick={handleApply}
            className="w-full rounded-full bg-accent py-2.5 text-[13px] font-bold text-[#08090A]"
          >
            Aplicar filtro
          </button>
        </div>
      </div>
    </div>
  );
}
