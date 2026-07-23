import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { fetchEvPicks, type EvPick } from "../../lib/evPlus";
import {
  applyEvFilters,
  areFiltersDefault,
  defaultEvFilters,
  loadSavedEvFilters,
  providerKey,
  type EvFilterState,
  type SavedEvFilter,
} from "../../lib/evFilters";
import { EvFilterModal } from "./EvFilterModal";
import { SavedFiltersModal } from "./SavedFiltersModal";
import { Toggle } from "../../components/Toggle";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconTrendingUp,
  IconSearch,
  IconTune,
} from "../../components/Icon";

const NOT_FOUND_CREST = "https://robotip.com.br/robotip_imgs/teams_imgs/not-found.png";
const PAGE_SIZE = 20;

function onCrestError(e: SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.src = NOT_FOUND_CREST;
}

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function matchesSearch(pick: EvPick, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    pick.homeTeam.toLowerCase().includes(q) ||
    pick.awayTeam.toLowerCase().includes(q) ||
    (pick.competition?.toLowerCase().includes(q) ?? false)
  );
}

type StatusTab = "all" | "live" | "upcoming";

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "live", label: "Ao vivo" },
  { key: "upcoming", label: "Pré-jogo" },
];

type SortKey = "kickoff" | "market" | "oddBookie" | "oddFair" | "evPct";

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "kickoff", label: "Jogo" },
  { key: "market", label: "Mercado" },
  { key: "oddBookie", label: "Odd mercado" },
  { key: "oddFair", label: "Odd justa" },
  { key: "evPct", label: "EV" },
];

const MOBILE_SORT_OPTIONS: { key: SortKey; dir: "asc" | "desc"; label: string }[] = [
  { key: "evPct", dir: "desc", label: "Maior EV" },
  { key: "evPct", dir: "asc", label: "Menor EV" },
  { key: "oddBookie", dir: "desc", label: "Maior odd mercado" },
  { key: "oddBookie", dir: "asc", label: "Menor odd mercado" },
  { key: "kickoff", dir: "asc", label: "Jogo mais próximo" },
];

function sortLabel(key: SortKey, dir: "asc" | "desc"): string {
  if (key === "evPct") return dir === "desc" ? "maior EV" : "menor EV";
  if (key === "kickoff") return dir === "asc" ? "jogo mais próximo" : "jogo mais distante";
  const col = SORT_COLUMNS.find((c) => c.key === key)?.label ?? key;
  return `${dir === "desc" ? "maior" : "menor"} ${col.toLowerCase()}`;
}

function sortValue(pick: EvPick, key: SortKey): number | string {
  switch (key) {
    case "kickoff":
      return new Date(pick.kickoff).getTime();
    case "market":
      return pick.market;
    case "oddBookie":
      return pick.oddBookie;
    case "oddFair":
      return pick.oddFair;
    case "evPct":
      return pick.evPct;
  }
}

function CrestName({ src, name }: { src: string; name: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <img
        src={src}
        onError={onCrestError}
        alt=""
        className="h-4 w-4 flex-none rounded-full bg-surface-chip object-contain"
      />
      <span className="truncate text-[13px] font-semibold">{name}</span>
    </div>
  );
}

function KickoffBadge({ pick }: { pick: EvPick }) {
  return (
    <div className="mb-1.5 flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-text-tertiary">
      <span className="flex-none">{formatKickoff(pick.kickoff)}</span>
      {pick.status === "live" && (
        <span className="flex flex-none items-center gap-1 text-live">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
          AO VIVO
        </span>
      )}
      {pick.competition && <span className="truncate text-text-quaternary">· {pick.competition}</span>}
    </div>
  );
}

function EvValue({ evPct }: { evPct: number }) {
  return (
    <span className={`font-mono text-[13px] font-bold ${evPct >= 0 ? "text-accent" : "text-live"}`}>
      {evPct >= 0 ? "+" : ""}
      {evPct.toFixed(2)}%
    </span>
  );
}

function PaginationControl({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-3 font-mono text-[12px] text-text-tertiary">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Página anterior"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border-strong disabled:opacity-30"
      >
        <IconChevronLeft size={15} />
      </button>
      <span>
        Página {page} de {totalPages}
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Próxima página"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border-strong disabled:opacity-30"
      >
        <IconChevronRight size={15} />
      </button>
    </div>
  );
}

function EvTable({
  picks,
  sortKey,
  sortDir,
  onSortClick,
  showProbability,
}: {
  picks: EvPick[];
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSortClick: (key: SortKey) => void;
  showProbability: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border bg-surface">
            {SORT_COLUMNS.map((col) => (
              <th key={col.key} className="px-3 py-2.5 text-left">
                <button
                  onClick={() => onSortClick(col.key)}
                  className={`flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide ${
                    sortKey === col.key ? "text-text" : "text-text-tertiary"
                  }`}
                >
                  {col.key === "oddFair" && showProbability ? "Probabilidade" : col.label}
                  <IconChevronDown
                    size={11}
                    className={`transition-transform ${sortKey === col.key && sortDir === "asc" ? "rotate-180" : ""} ${
                      sortKey === col.key ? "text-accent" : "text-text-quaternary"
                    }`}
                  />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {picks.map((pick) => (
            <tr key={pick.id} className={`${pick.evPct >= 0 ? "bg-accent-soft" : "bg-bg"} hover:bg-surface`}>
              <td className="min-w-[240px] px-3 py-3 align-top">
                <KickoffBadge pick={pick} />
                <CrestName src={pick.homeImageUrl} name={pick.homeTeam} />
                <div className="mt-1">
                  <CrestName src={pick.awayImageUrl} name={pick.awayTeam} />
                </div>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="text-[13px] font-semibold">{pick.market}</div>
                {pick.bookie && (
                  <div className="mt-0.5 font-mono text-[10px] text-text-tertiary">{pick.bookie}</div>
                )}
                <button
                  type="button"
                  disabled
                  title="Em breve"
                  className="mt-1.5 rounded-md border border-border-strong px-2 py-0.5 font-mono text-[10px] text-text-quaternary"
                >
                  + Adc na gestão
                </button>
              </td>
              <td className="px-3 py-3 align-top font-mono text-[13px] font-bold">
                {pick.oddBookie.toFixed(3)}
              </td>
              <td className="px-3 py-3 align-top font-mono text-[13px] font-bold">
                {showProbability ? `${pick.probFairPct.toFixed(1)}%` : pick.oddFair.toFixed(3)}
              </td>
              <td className="px-3 py-3 align-top">
                <EvValue evPct={pick.evPct} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EvRow({ pick, showProbability }: { pick: EvPick; showProbability: boolean }) {
  return (
    <div className={`rounded-2xl border border-border p-3 ${pick.evPct >= 0 ? "bg-accent-soft" : "bg-surface"}`}>
      <KickoffBadge pick={pick} />
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">
            {pick.homeTeam} <span className="text-text-quaternary">x</span> {pick.awayTeam}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-text-secondary">{pick.market}</div>
        </div>
        <div className="flex-none text-right">
          <div className="font-mono text-[12px] text-text-secondary">
            {pick.oddBookie.toFixed(2)} <span className="text-text-quaternary">→</span>{" "}
            {showProbability ? `${pick.probFairPct.toFixed(1)}%` : pick.oddFair.toFixed(2)}
          </div>
          <EvValue evPct={pick.evPct} />
        </div>
      </div>
    </div>
  );
}

export function EvPage() {
  const [data, setData] = useState<{ picks: EvPick[]; unavailable: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<EvFilterState>(defaultEvFilters);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [savedModalOpen, setSavedModalOpen] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedEvFilter[]>([]);
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [showProbability, setShowProbability] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("evPct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchEvPicks().then(setData);
    setSavedFilters(loadSavedEvFilters());
  }, []);

  const providers = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.picks.map((p) => providerKey(p.bookie)))].sort();
  }, [data]);

  const marketCategories = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.picks.map((p) => p.marketCategory))].sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return applyEvFilters(data.picks, filters)
      .filter((p) => matchesSearch(p, search))
      .filter((p) => statusTab === "all" || p.status === statusTab);
  }, [data, filters, search, statusTab]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * dir;
      }
      return (av - bv) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [filters, search, statusTab]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function onSortClick(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function onMobileSortChange(value: string) {
    const opt = MOBILE_SORT_OPTIONS[Number(value)];
    if (!opt) return;
    setSortKey(opt.key);
    setSortDir(opt.dir);
  }

  const filtersActive = !areFiltersDefault(filters);
  const mobileSortIndex = MOBILE_SORT_OPTIONS.findIndex((o) => o.key === sortKey && o.dir === sortDir);

  return (
    <div className="flex min-h-full flex-col bg-bg text-text">
      {/* Desktop header */}
      <div className="hidden flex-none items-center gap-3 border-b border-border px-8 py-[18px] lg:flex">
        <div className="flex flex-1 items-center gap-2 text-[22px] font-bold tracking-[-0.02em]">
          EV<span className="text-accent">+</span>
          <span className="font-mono text-[12px] font-normal text-text-tertiary">
            · Tabela · Valor esperado positivo · IA
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
          <IconSearch size={15} className="flex-none text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar por ligas, times"
            className="w-56 bg-transparent text-[13px] outline-none placeholder:text-text-tertiary"
          />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-text-secondary">
          Probabilidade
          <Toggle on={showProbability} onChange={() => setShowProbability((v) => !v)} />
        </label>
        <button
          onClick={() => setFilterModalOpen(true)}
          className="relative flex items-center gap-1.5 rounded-xl border border-border-strong bg-surface-chip px-3.5 py-2 text-[13px] font-semibold"
        >
          <IconTune size={15} />
          Filtro
          {filtersActive && (
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent" />
          )}
        </button>
      </div>

      {/* Mobile header */}
      <div className="flex items-center gap-3 px-5 pb-1 pt-3 lg:hidden">
        <div className="flex-1">
          <div className="text-[20px] font-bold tracking-[-0.02em]">EV+ · Tabela</div>
          {data && (
            <div className="font-mono text-[11px] text-text-tertiary">
              {filtered.length} oportunidade{filtered.length === 1 ? "" : "s"}
            </div>
          )}
        </div>
        <button
          onClick={() => setFilterModalOpen(true)}
          aria-label="Filtros"
          className="relative flex h-9 w-9 flex-none items-center justify-center rounded-full bg-accent text-[#08090A]"
        >
          <IconTune size={15} />
          {filtersActive && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-live" />
          )}
        </button>
      </div>

      <div className="flex-1 px-5 py-4 lg:px-8 lg:py-6">
        <div className="mx-auto flex w-full max-w-[1000px] flex-col">
          {/* Status tabs */}
          <div className="mb-3 flex items-center gap-2 overflow-x-auto">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setStatusTab(t.key)}
                className={`flex-none rounded-full px-3.5 py-1.5 text-[12px] font-semibold ${
                  statusTab === t.key ? "bg-accent text-[#08090A]" : "bg-surface-alt text-text-secondary"
                }`}
              >
                {t.label}
              </button>
            ))}
            <button
              onClick={() => setSavedModalOpen(true)}
              className="flex-none rounded-full bg-surface-alt px-3.5 py-1.5 text-[12px] font-semibold text-text-secondary"
            >
              Filtros salvos
            </button>

            {data && data.picks.length > 0 && (
              <span className="ml-auto hidden flex-none whitespace-nowrap font-mono text-[11px] text-text-tertiary lg:inline">
                {filtered.length} oportunidades · ordenar: {sortLabel(sortKey, sortDir)}
              </span>
            )}
          </div>

          {/* Mobile sort selector */}
          {filtered.length > 0 && (
            <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-wide text-text-tertiary lg:hidden">
              <span>Jogo · Mercado</span>
              <select
                value={mobileSortIndex === -1 ? 0 : mobileSortIndex}
                onChange={(e) => onMobileSortChange(e.target.value)}
                className="bg-transparent text-right text-text-secondary"
              >
                {MOBILE_SORT_OPTIONS.map((o, i) => (
                  <option key={i} value={i}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {data === null && (
            <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>
          )}

          {data?.unavailable && (
            <p className="py-10 text-center text-sm text-text-tertiary">
              Não foi possível buscar as previsões da IA agora. Tenta de novo em instantes.
            </p>
          )}

          {data && !data.unavailable && data.picks.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <IconTrendingUp size={30} className="text-accent" />
              <p className="max-w-xs text-sm text-text-secondary">
                Nenhuma previsão disponível no momento, volta aqui quando tiver jogo com odd
                mapeada por um bookmaker.
              </p>
            </div>
          )}

          {data && data.picks.length > 0 && filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-text-tertiary">
              {search
                ? `Nenhum resultado para "${search}".`
                : "Nenhuma previsão bate com os filtros aplicados."}
            </p>
          )}

          {pageItems.length > 0 && (
            <>
              <div className="hidden lg:block">
                <EvTable
                  picks={pageItems}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSortClick={onSortClick}
                  showProbability={showProbability}
                />
              </div>
              <div className="flex flex-col gap-2.5 lg:hidden">
                {pageItems.map((pick) => (
                  <EvRow key={pick.id} pick={pick} showProbability={showProbability} />
                ))}
              </div>
              <PaginationControl page={page} totalPages={totalPages} onChange={setPage} />
            </>
          )}
        </div>
      </div>

      <EvFilterModal
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        filters={filters}
        onApply={setFilters}
        providers={providers}
        marketCategories={marketCategories}
        onOpenSavedFilters={() => setSavedModalOpen(true)}
        onFilterSaved={() => setSavedFilters(loadSavedEvFilters())}
      />
      <SavedFiltersModal
        open={savedModalOpen}
        onClose={() => setSavedModalOpen(false)}
        savedFilters={savedFilters}
        onApply={setFilters}
        onDeleted={setSavedFilters}
      />
    </div>
  );
}
