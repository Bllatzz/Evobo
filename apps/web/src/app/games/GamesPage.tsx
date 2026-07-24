import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { fetchLiveGames, type LiveGame } from "../../lib/gamesLive";
import {
  applyGamesFilters,
  areFiltersDefault,
  defaultGamesFilters,
  loadSavedGamesFilters,
  type GamesFilterState,
  type SavedGamesFilter,
} from "../../lib/gamesFilters";
import { GamesFilterModal } from "./GamesFilterModal";
import { GamesSavedFiltersModal } from "./GamesSavedFiltersModal";
import { PaginationControl } from "../../components/PaginationControl";
import { CrestName } from "../../components/CrestName";
import { useDragScroll } from "../../hooks/useDragScroll";
import { IconSearch, IconTune, IconCornerFlag } from "../../components/Icon";

const PAGE_SIZE = 12; // leagues per page
const REFRESH_MS = 30_000; // live scores/odds change fast enough to be worth polling

// Pure calendar-date math on the YYYY-MM-DD string itself (never through a
// browser-local Date + toISOString — that shifts by the local UTC offset,
// so anyone in Brazil (UTC-3) opening this after ~21h local time got
// "Hoje" showing tomorrow's games, "Ontem" showing today's, and so on,
// since toISOString() had already rolled into the next UTC day).
function todayIsoSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function formatDayMonth(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function dayLabel(offset: number, iso: string): string {
  if (offset === -1) return "Ontem";
  if (offset === 0) return "Hoje";
  if (offset === 1) return "Amanhã";
  return formatDayMonth(iso);
}

// Wide enough to fill the row on desktop (the tab strip lives inside a
// max-w-[1000px] container, so this doesn't need to account for wider
// monitors) without leaving empty space before the "N jogos" counter;
// mobile just scrolls through the extra days.
const DATE_TABS_BEFORE = 7;
const DATE_TABS_AFTER = 7;

function buildDateTabs(today: string) {
  const tabs = [];
  for (let offset = -DATE_TABS_BEFORE; offset <= DATE_TABS_AFTER; offset++) {
    const date = addDaysIso(today, offset);
    tabs.push({ date, offset, label: dayLabel(offset, date) });
  }
  return tabs;
}

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function matchesSearch(game: LiveGame, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    game.homeTeam.toLowerCase().includes(q) ||
    game.awayTeam.toLowerCase().includes(q) ||
    game.league.toLowerCase().includes(q)
  );
}

type SortKey = "popularity" | "kickoff" | "upcoming" | "featured";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "popularity", label: "Popularidade" },
  { key: "kickoff", label: "Horário" },
  { key: "upcoming", label: "Próximos" },
  { key: "featured", label: "Em destaque" },
];

// "upcoming" and "featured" also narrow the list to games that haven't kicked
// off yet — "featured" is Próximos + Popularidade combined (future games,
// ranked by popularity) instead of plain chronological order.
const FUTURE_ONLY_SORTS: SortKey[] = ["upcoming", "featured"];

const SORT_DIRECTION: Record<SortKey, "asc" | "desc"> = {
  popularity: "desc",
  kickoff: "asc",
  upcoming: "asc",
  featured: "desc",
};

function statusPriority(g: LiveGame): number {
  return g.status === "live" ? 0 : g.status === "scheduled" ? 1 : 2;
}

function compareGames(a: LiveGame, b: LiveGame): number {
  const sp = statusPriority(a) - statusPriority(b);
  if (sp !== 0) return sp;
  return new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime();
}

type LeagueGroup = {
  league: string;
  leagueCountry: string | null;
  leagueImageUrl: string;
  games: LiveGame[];
};

function groupByLeague(games: LiveGame[]): LeagueGroup[] {
  const map = new Map<string, LeagueGroup>();
  for (const g of games) {
    let group = map.get(g.league);
    if (!group) {
      group = { league: g.league, leagueCountry: g.leagueCountry, leagueImageUrl: g.leagueImageUrl, games: [] };
      map.set(g.league, group);
    }
    group.games.push(g);
  }
  return [...map.values()];
}

function leagueSortValue(group: LeagueGroup, key: SortKey): number {
  if (key === "kickoff" || key === "upcoming") {
    return Math.min(...group.games.map((g) => new Date(g.kickoff).getTime()));
  }
  return Math.max(...group.games.map((g) => g.popularity));
}

const WORLD_FLAG_URL = "https://robotip.com.br/robotip_imgs/flags/wrd.png";

function onLeagueImageError(e: SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.src = WORLD_FLAG_URL;
}

function OddChip({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-1 items-center justify-between rounded-lg bg-surface-chip px-2.5 py-1.5">
      <span className="font-mono text-[10px] text-text-tertiary">{label}</span>
      <span className="font-mono text-[12px] font-bold">{value !== null ? value.toFixed(2) : "-"}</span>
    </div>
  );
}

function TeamStatRow({
  yellow,
  red,
  corners,
}: {
  yellow: number | null;
  red: number | null;
  corners: number | null;
}) {
  return (
    <div className="flex items-center gap-3 font-mono text-[10px] text-text-tertiary">
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2 rounded-[2px] bg-[#F6C453]" />
        {yellow ?? 0}
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2 rounded-[2px] bg-live" />
        {red ?? 0}
      </span>
      <span className="flex items-center gap-1">
        <IconCornerFlag size={11} />
        {corners ?? 0}
      </span>
    </div>
  );
}

function GameRow({ game }: { game: LiveGame }) {
  const isLive = game.status === "live";
  const isFinished = game.status === "finished";
  const showScore = isLive || isFinished;
  const showOdds = game.oddHome !== null;
  const showStats = game.cornersHome !== null;

  return (
    <div className="p-3.5">
      <div className="flex items-center gap-3">
        <div className="w-11 flex-none text-center font-mono text-[11px]">
          {isLive ? (
            <span className="flex items-center justify-center gap-1 text-live">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
              {game.minute ?? 0}'
            </span>
          ) : isFinished ? (
            <span className="text-text-quaternary">FIM</span>
          ) : (
            <span className="text-text-tertiary">{formatKickoff(game.kickoff)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <CrestName src={game.homeImageUrl} name={game.homeTeam} />
            {showScore && <span className="font-mono text-[13px] font-bold">{game.scoreHome ?? 0}</span>}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <CrestName src={game.awayImageUrl} name={game.awayTeam} />
            {showScore && <span className="font-mono text-[13px] font-bold">{game.scoreAway ?? 0}</span>}
          </div>
        </div>
      </div>

      {showOdds && (
        <div className="mt-2.5 flex gap-2 pl-14">
          <OddChip label="1" value={game.oddHome} />
          <OddChip label="X" value={game.oddDraw} />
          <OddChip label="2" value={game.oddAway} />
        </div>
      )}

      {showStats && (
        <div className="mt-2 flex flex-col gap-1 pl-14">
          <TeamStatRow yellow={game.yellowHome} red={game.redHome} corners={game.cornersHome} />
          <TeamStatRow yellow={game.yellowAway} red={game.redAway} corners={game.cornersAway} />
        </div>
      )}
    </div>
  );
}

function LeagueCard({ group }: { group: LeagueGroup }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 px-1">
        <img
          src={group.leagueImageUrl}
          onError={onLeagueImageError}
          alt=""
          className="h-[18px] w-[18px] flex-none rounded-full bg-surface-chip object-cover"
        />
        <span className="truncate font-mono text-[12px] font-semibold text-text-tertiary">
          {group.league.toUpperCase()}
        </span>
      </div>
      <div className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border bg-surface">
        {group.games.map((game) => (
          <GameRow key={game.gameId} game={game} />
        ))}
      </div>
    </div>
  );
}

export function GamesPage() {
  const today = useMemo(todayIsoSaoPaulo, []);
  const dateTabs = useMemo(() => buildDateTabs(today), [today]);
  const [data, setData] = useState<{ games: LiveGame[]; unavailable: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<GamesFilterState>(() => ({
    ...defaultGamesFilters(),
    date: today,
  }));
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [savedModalOpen, setSavedModalOpen] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedGamesFilter[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("popularity");
  const [liveOnly, setLiveOnly] = useState(false);
  const [page, setPage] = useState(1);
  const todayTabRef = useRef<HTMLButtonElement>(null);
  const dragScrollRef = useDragScroll<HTMLDivElement>();

  useEffect(() => {
    setSavedFilters(loadSavedGamesFilters());
  }, []);

  // The tab strip spans more days than fit on screen — start centered on "Hoje".
  useEffect(() => {
    todayTabRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetchLiveGames(filters.date).then((res) => {
        if (!cancelled) setData(res);
      });
    }
    setData(null);
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [filters.date]);

  useEffect(() => {
    setPage(1);
  }, [filters, search, sortKey, liveOnly]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return applyGamesFilters(data.games, filters).filter((g) => matchesSearch(g, search));
  }, [data, filters, search]);

  const displayed = useMemo(() => {
    let list = filtered;
    if (liveOnly) list = list.filter((g) => g.status === "live");
    if (FUTURE_ONLY_SORTS.includes(sortKey)) {
      const now = Date.now();
      list = list.filter((g) => new Date(g.kickoff).getTime() > now);
    }
    return list;
  }, [filtered, liveOnly, sortKey]);

  const sortedLeagues = useMemo(() => {
    const groups = groupByLeague(displayed).map((g) => ({
      ...g,
      games: [...g.games].sort(compareGames),
    }));
    const dir = SORT_DIRECTION[sortKey] === "asc" ? 1 : -1;
    groups.sort((a, b) => (leagueSortValue(a, sortKey) - leagueSortValue(b, sortKey)) * dir);
    return groups;
  }, [displayed, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedLeagues.length / PAGE_SIZE));
  const pageLeagues = sortedLeagues.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const liveCount = data ? data.games.filter((g) => g.status === "live").length : 0;
  const filtersActive = !areFiltersDefault(filters);

  return (
    <div className="flex min-h-full flex-col bg-bg text-text">
      {/* Desktop header */}
      <div className="hidden flex-none items-center gap-3 border-b border-border px-8 py-[18px] lg:flex">
        <div className="flex-1 text-[22px] font-bold tracking-[-0.02em]">Jogos</div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
          <IconSearch size={15} className="flex-none text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtre por ligas e times"
            className="w-56 bg-transparent text-[13px] outline-none placeholder:text-text-tertiary"
          />
        </div>
        <button
          onClick={() => setLiveOnly((v) => !v)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[12px] ${
            liveOnly
              ? "border-live bg-live text-[#08090A]"
              : "border-border-strong bg-surface-chip text-text-secondary"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${liveOnly ? "bg-[#08090A]" : "bg-live"}`} />
          Ao vivo: {liveCount}/{data?.games.length ?? 0}
        </button>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-xl border border-border-strong bg-surface-chip px-3 py-2 text-[13px] font-semibold"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
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
          <div className="text-[20px] font-bold tracking-[-0.02em]">Jogos</div>
          {data && (
            <button
              onClick={() => setLiveOnly((v) => !v)}
              className={`font-mono text-[11px] ${liveOnly ? "font-bold text-live" : "text-text-tertiary"}`}
            >
              Ao vivo: {liveCount}/{data.games.length}
            </button>
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
          {/* Date tabs */}
          <div className="mb-3 flex items-center gap-2">
            <div ref={dragScrollRef} className="no-scrollbar drag-scroll flex flex-1 gap-2 overflow-x-auto">
              {dateTabs.map((t) => (
                <button
                  key={t.date}
                  ref={t.offset === 0 ? todayTabRef : undefined}
                  onClick={() => setFilters((f) => ({ ...f, date: t.date }))}
                  className={`flex-none rounded-full px-3.5 py-1.5 font-mono text-[12px] font-semibold ${
                    filters.date === t.date ? "bg-accent text-[#08090A]" : "bg-surface-alt text-text-secondary"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {data && (
              <span className="ml-auto hidden flex-none whitespace-nowrap font-mono text-[11px] text-text-tertiary lg:inline">
                {displayed.length} jogos
              </span>
            )}
          </div>

          {/* Mobile search + sort */}
          <div className="mb-3 flex items-center gap-2 lg:hidden">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
              <IconSearch size={14} className="flex-none text-text-tertiary" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ligas e times"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-tertiary"
              />
            </div>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-xl border border-border-strong bg-surface-alt px-2.5 py-2 text-[12px] font-semibold"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {data === null && (
            <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>
          )}

          {data?.unavailable && (
            <p className="py-10 text-center text-sm text-text-tertiary">
              Não foi possível buscar os jogos agora. Tenta de novo em instantes.
            </p>
          )}

          {data && !data.unavailable && data.games.length === 0 && (
            <p className="py-10 text-center text-sm text-text-tertiary">Nenhum jogo neste dia.</p>
          )}

          {data && data.games.length > 0 && displayed.length === 0 && (
            <p className="py-10 text-center text-sm text-text-tertiary">
              {search ? `Nenhum resultado para "${search}".` : "Nenhum jogo bate com os filtros aplicados."}
            </p>
          )}

          {pageLeagues.length > 0 && (
            <>
              <div className="flex flex-col gap-4">
                {pageLeagues.map((group) => (
                  <LeagueCard key={group.league} group={group} />
                ))}
              </div>
              <PaginationControl page={page} totalPages={totalPages} onChange={setPage} />
            </>
          )}
        </div>
      </div>

      <GamesFilterModal
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        filters={filters}
        onApply={setFilters}
        onOpenSavedFilters={() => setSavedModalOpen(true)}
        onFilterSaved={() => setSavedFilters(loadSavedGamesFilters())}
      />
      <GamesSavedFiltersModal
        open={savedModalOpen}
        onClose={() => setSavedModalOpen(false)}
        savedFilters={savedFilters}
        onApply={setFilters}
        onDeleted={setSavedFilters}
      />
    </div>
  );
}
