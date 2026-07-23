import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { useNavigate } from "react-router-dom";
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
import {
  IconChevronLeft,
  IconChevronDown,
  IconTrendingUp,
  IconSearch,
  IconTune,
} from "../../components/Icon";

const NOT_FOUND_CREST = "https://robotip.com.br/robotip_imgs/teams_imgs/not-found.png";

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

type SortKey = "kickoff" | "market" | "oddBookie" | "oddFair" | "evPct";

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "kickoff", label: "Jogo" },
  { key: "market", label: "Mercado" },
  { key: "oddBookie", label: "Odd mercado" },
  { key: "oddFair", label: "Odd justa" },
  { key: "evPct", label: "EV" },
];

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

function EvTable({ picks }: { picks: EvPick[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("kickoff");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...picks].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * dir;
      }
      return (av - bv) * dir;
    });
  }, [picks, sortKey, sortDir]);

  function onSortClick(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

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
                  {col.label}
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
          {sorted.map((pick) => (
            <tr key={pick.id} className="bg-bg hover:bg-surface">
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
              </td>
              <td className="px-3 py-3 align-top font-mono text-[13px] font-bold">
                {pick.oddBookie.toFixed(3)}
              </td>
              <td className="px-3 py-3 align-top font-mono text-[13px] font-bold">
                {pick.oddFair.toFixed(3)}
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

function EvRow({ pick }: { pick: EvPick }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <KickoffBadge pick={pick} />
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <CrestName src={pick.homeImageUrl} name={pick.homeTeam} />
          <div className="mt-1">
            <CrestName src={pick.awayImageUrl} name={pick.awayTeam} />
          </div>
        </div>
        <div className="flex-none text-right">
          <EvValue evPct={pick.evPct} />
          <div className="mt-1 font-mono text-[10px] text-text-tertiary">
            {pick.oddBookie.toFixed(3)} / {pick.oddFair.toFixed(3)}
          </div>
        </div>
      </div>
      <div className="mt-2 truncate rounded-lg bg-surface-chip px-2 py-1 text-[11px] text-text-secondary">
        {pick.market}
        {pick.bookie && <span className="ml-1.5 font-mono text-[9px] text-text-tertiary">{pick.bookie}</span>}
      </div>
    </div>
  );
}

export function EvPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ picks: EvPick[]; unavailable: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<EvFilterState>(defaultEvFilters);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [savedModalOpen, setSavedModalOpen] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedEvFilter[]>([]);

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
    return applyEvFilters(data.picks, filters).filter((p) => matchesSearch(p, search));
  }, [data, filters, search]);

  const filtersActive = !areFiltersDefault(filters);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <div className="flex items-center gap-3 px-5 pb-1 pt-14 lg:px-8 lg:pt-6">
        <button onClick={() => navigate(-1)} className="lg:hidden" aria-label="Voltar">
          <IconChevronLeft size={22} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 text-[24px] font-bold tracking-[-0.02em]">
            EV<span className="text-accent">+</span>
          </div>
        </div>
        {data && data.picks.length > 0 && (
          <span className="flex-none font-mono text-[11px] text-text-tertiary">
            {filtered.length} de {data.picks.length}
          </span>
        )}
      </div>

      <div className="flex-1 px-5 py-4 lg:px-8 lg:py-6">
        <div className="mx-auto flex w-full max-w-[1000px] flex-col">
          {data && data.picks.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
                <IconSearch size={15} className="flex-none text-text-tertiary" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filtrar por ligas, times"
                  className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-tertiary"
                />
              </div>
              <button
                onClick={() => setFilterModalOpen(true)}
                aria-label="Filtros avançados"
                className="relative flex flex-none items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-text-secondary"
              >
                <IconTune size={15} />
                {filtersActive && (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent" />
                )}
              </button>
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

          {filtered.length > 0 && (
            <>
              <div className="hidden lg:block">
                <EvTable picks={filtered} />
              </div>
              <div className="flex flex-col gap-2.5 lg:hidden">
                {[...filtered]
                  .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime())
                  .map((pick) => (
                    <EvRow key={pick.id} pick={pick} />
                  ))}
              </div>
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
