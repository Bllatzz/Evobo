import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { fetchMyBets, type ProfileTip } from "../../lib/profile";
import { formatOdds, formatUnits } from "../../lib/format";
import { Avatar } from "../../components/Avatar";
import { AccountMenu } from "../../components/AccountMenu";
import { useAuth } from "../../stores/auth";
import { bookmakerLabel } from "../../lib/bookmakers";
import { IconCheck, IconX, IconPlus, IconPencil } from "../../components/Icon";
import {
  fetchTelegramSettings,
  saveTelegramSettings,
  fetchBookmakerBalances,
  saveBookmakerBalances,
  fetchBookmakerNames,
  fetchTelegramBanca,
  fetchTelegramTips,
  type TelegramBookmakerBalance,
  type TelegramBancaSummary,
} from "../../lib/telegramTips";
import type { TelegramBancaRow } from "@evobo/shared-types";

const resultLabel: Record<string, { text: string; className: string; Icon?: typeof IconCheck }> = {
  green: { text: "Green", className: "text-accent", Icon: IconCheck },
  red: { text: "Red", className: "text-live", Icon: IconX },
  void: { text: "Anulada", className: "text-text-tertiary" },
  reembolso: { text: "Reembolso", className: "text-text-tertiary" },
  pending: { text: "Em aberto", className: "text-text-tertiary" },
};

const STARTING_BANKROLL_UNITS = 10;
const OTHER_OPTION = "__outra__";

function betProfit(tip: ProfileTip): number {
  const odds = Number(tip.odds);
  const stake = Number(tip.stakeUnits);
  if (tip.status === "green") return stake * (odds - 1);
  if (tip.status === "red") return -stake;
  return 0;
}

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Small fixed rotation over Evobo's own brand hues (never a per-bookmaker
// invented color) so each bookmaker keeps a stable dot across renders.
const DOT_COLORS = ["bg-accent", "bg-live", "bg-vip", "bg-verified", "bg-orange"];
function bookmakerColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return DOT_COLORS[hash % DOT_COLORS.length]!;
}

type TimelineEvent = { date: number; profit: number };
type SeriesPoint = TelegramBancaSummary["series"]["peguei"][number];

const RANGE_OPTIONS = [
  { key: "7", label: "7d" },
  { key: "30", label: "30d" },
  { key: "90", label: "90d" },
  { key: "all", label: "Tudo" },
] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];

/** Real cumulative bankroll evolution (starting banca inicial + running pnl),
 * native bets and Telegram taken tips merged into one chronological line —
 * same non-fabricated approach as the Gráfico Robô wallet chart. `startValue`
 * is the bankroll at the start of the visible window (equals `referenceValue`
 * — the true, all-time banca inicial — only when the window is "tudo"); the
 * dashed reference line always marks the true banca inicial so the user can
 * tell at a glance whether they're above or below where they started, even
 * when zoomed into a shorter window. */
function BankrollChart({
  timeline,
  startValue,
  referenceValue,
  unitValue,
  displayUnit,
}: {
  timeline: TimelineEvent[];
  startValue: number;
  referenceValue: number;
  unitValue: number | null;
  displayUnit: "u" | "brl";
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chronological = [...timeline].sort((a, b) => a.date - b.date);

  function formatValue(v: number): string {
    if (displayUnit === "brl" && unitValue != null) return brl(v * unitValue);
    return `${v.toFixed(1)}u`;
  }

  if (chronological.length < 2) {
    return (
      <div className="flex h-[140px] items-center justify-center text-[12px] text-text-tertiary">
        Poucas apostas resolvidas para desenhar o gráfico.
      </div>
    );
  }

  let cumulative = startValue;
  const values = chronological.map((e) => {
    cumulative += e.profit;
    return cumulative;
  });
  const min = Math.min(startValue, referenceValue, ...values);
  const max = Math.max(startValue, referenceValue, ...values);
  const span = max - min || 1;
  const width = 600;
  const height = 140;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPoints = `0,${height} ${points.join(" ")} ${width},${height}`;
  const refY = height - ((referenceValue - min) / span) * height;
  const yLabels = [max, (max + min) / 2, min];

  function handleMove(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    const index = Math.round(fraction * (values.length - 1));
    setHoverIndex(Math.min(values.length - 1, Math.max(0, index)));
  }

  const hovered = hoverIndex !== null ? chronological[hoverIndex] : null;
  const hoveredValue = hoverIndex !== null ? values[hoverIndex]! : null;
  const hoverX = hoverIndex !== null ? (hoverIndex / (values.length - 1)) * width : 0;
  const hoverY = hoverIndex !== null ? height - ((values[hoverIndex]! - min) / span) * height : 0;
  // Flip the tooltip to the left half once the point crosses the chart's midline, so it never clips outside the svg.
  const tooltipLeftPct = (hoverX / width) * 100;
  const tooltipAlign = tooltipLeftPct > 60 ? "right" : tooltipLeftPct < 40 ? "left" : "center";

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
        className="cursor-crosshair"
      >
        <defs>
          <linearGradient id="bankrollFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.4" className="text-accent" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" className="text-accent" />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill="url(#bankrollFill)" />
        <line
          x1={0}
          y1={refY}
          x2={width}
          y2={refY}
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="5 4"
          className="text-text-quaternary"
          vectorEffect="non-scaling-stroke"
        />
        <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="text-accent" />
        {hovered && (
          <>
            <line
              x1={hoverX}
              y1={0}
              x2={hoverX}
              y2={height}
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="4 3"
              className="text-border-strong"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={hoverX}
              cy={hoverY}
              r="4"
              className="text-accent"
              fill="currentColor"
              stroke="var(--color-surface-chip, #fff)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>

      <div className="pointer-events-none absolute inset-0">
        {yLabels.map((v, i) => (
          <span
            key={i}
            className="absolute left-1 -translate-y-1/2 rounded bg-surface/80 px-1 font-mono text-[10px] text-text-tertiary"
            style={{ top: `${(((height - ((v - min) / span) * height) / height) * 100).toFixed(2)}%` }}
          >
            {formatValue(v)}
          </span>
        ))}
        <span
          className="absolute right-1 -translate-y-full rounded bg-surface/80 px-1 font-mono text-[10px] text-text-tertiary"
          style={{ top: `${((refY / height) * 100).toFixed(2)}%` }}
        >
          banca inicial {formatValue(referenceValue)}
        </span>
      </div>

      {hovered && hoveredValue !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-border bg-surface-alt px-2.5 py-1.5 font-mono text-[11px] shadow-lg"
          style={{
            left: tooltipAlign === "center" ? `${tooltipLeftPct}%` : tooltipAlign === "left" ? "0%" : undefined,
            right: tooltipAlign === "right" ? "0%" : undefined,
            transform: tooltipAlign === "center" ? "translateX(-50%)" : undefined,
          }}
        >
          <div className="text-text-tertiary">{new Date(hovered.date).toLocaleDateString("pt-BR")}</div>
          <div className={`font-bold ${hoveredValue >= referenceValue ? "text-accent" : "text-live"}`}>
            {formatValue(hoveredValue)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Resolved-and-taken totals from the Telegram tracker, folded into the
 * profile's own bankroll/winrate/tips-count — the profile is meant to be
 * one picture of "my results" for the whole site, not something split
 * between a native-bets number here and a separately-branded number under
 * VIP Telegram. Defaults to "no telegram data" for users without the
 * telegram_banca screen, which leaves every stat exactly as it was before. */
type TelegramFold = {
  bancaInicialUnits: number | null;
  unitValue: number | null;
  profitUnits: number;
  staked: number;
  green: number;
  red: number;
};
const NO_TELEGRAM_FOLD: TelegramFold = {
  bancaInicialUnits: null,
  unitValue: null,
  profitUnits: 0,
  staked: 0,
  green: 0,
  red: 0,
};

/** Compact ranked list — bookmakers or groups sorted by profit (best first),
 * filling the vertical space below the bankroll chart with something
 * actually useful instead of empty padding. */
function ProfitRankList({
  title,
  rows,
  unitValue,
  displayUnit,
  labelFor,
  dotFor,
}: {
  title: string;
  rows: TelegramBancaRow[];
  unitValue: number | null;
  displayUnit: "u" | "brl";
  labelFor?: (key: string) => string;
  dotFor?: (key: string) => string;
}) {
  function formatValue(v: number): string {
    if (displayUnit === "brl" && unitValue != null) return `${v >= 0 ? "+" : ""}${brl(v * unitValue)}`;
    return `${v >= 0 ? "+" : ""}${v.toFixed(1)}u`;
  }

  return (
    <div className="min-w-0">
      <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">{title}</div>
      {rows.length === 0 ? (
        <p className="text-[12px] text-text-tertiary">Sem dados ainda.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-2 rounded-[10px] bg-surface-alt px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                {dotFor && <span className={`h-2 w-2 flex-none rounded-full ${dotFor(row.key)}`} />}
                <span className="truncate text-[12.5px] font-semibold">{labelFor ? labelFor(row.key) : row.key}</span>
              </div>
              <span
                className={`flex-none font-mono text-[12px] font-bold ${row.profit >= 0 ? "text-accent" : "text-live"}`}
              >
                {formatValue(row.profit)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MyProfilePage() {
  const { me, canAccess } = useAuth();
  const [bets, setBets] = useState<ProfileTip[] | null>(null);
  const [tg, setTg] = useState<TelegramFold | null>(null);
  // Só a contagem real (o endpoint sempre limita `data` a 100 registros,
  // mas `total` reflete o total de verdade independente da paginação —
  // usar `data.length` aqui subestimava quem tem mais de 100 tips pegas).
  const [tgTipsCount, setTgTipsCount] = useState<number | null>(null);

  // "Unidade & saldos" — folded in from the old TelegramBancaOverview.
  const [unitValueRaw, setUnitValueRaw] = useState<string>("");
  const [editingUnitValue, setEditingUnitValue] = useState(false);
  const [balances, setBalances] = useState<TelegramBookmakerBalance[]>([]);
  const [bookmakerNames, setBookmakerNames] = useState<string[]>([]);
  const [addingBookmaker, setAddingBookmaker] = useState(false);
  const [newBookmaker, setNewBookmaker] = useState("");
  const [customBookmaker, setCustomBookmaker] = useState("");
  const [newBalance, setNewBalance] = useState("");
  const [savingBalances, setSavingBalances] = useState(false);
  // R$ profit from tips actually taken at that bookmaker — null while loading,
  // so balances render without a premature "sem lucro ainda" flash.
  const [profitByBookmaker, setProfitByBookmaker] = useState<Record<string, number | null> | null>(null);
  const [editingBookmaker, setEditingBookmaker] = useState<string | null>(null);

  // Ranked lists below the chart — bookmakers and groups sorted by profit.
  const [bookmakerRows, setBookmakerRows] = useState<TelegramBancaRow[]>([]);
  const [groupRows, setGroupRows] = useState<TelegramBancaRow[]>([]);

  // "Evolução da banca" chart controls.
  const [chartRange, setChartRange] = useState<RangeKey>("30");
  const [chartUnit, setChartUnit] = useState<"u" | "brl">("u");
  const [telegramSeries, setTelegramSeries] = useState<SeriesPoint[] | null>(null);

  const load = useCallback(() => {
    fetchMyBets().then(setBets);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!canAccess("telegram_banca")) {
      setTg(NO_TELEGRAM_FOLD);
      setTgTipsCount(0);
      setBalances([]);
      setBookmakerNames([]);
      setProfitByBookmaker({});
      setBookmakerRows([]);
      setGroupRows([]);
      return;
    }
    Promise.all([fetchTelegramSettings(), fetchBookmakerBalances(), fetchTelegramBanca(), fetchBookmakerNames()])
      .then(([settings, bals, banca, names]) => {
        const unitValue = settings.unitValue;
        const depositedTotal = bals.reduce((sum, b) => sum + b.balance, 0);
        const peguei = banca.totals.peguei;
        setTg({
          bancaInicialUnits: unitValue && unitValue > 0 ? depositedTotal / unitValue : null,
          unitValue,
          profitUnits: peguei?.profit ?? 0,
          staked: peguei?.staked ?? 0,
          green: peguei?.green ?? 0,
          red: peguei?.red ?? 0,
        });
        setUnitValueRaw(unitValue != null ? String(unitValue) : "");
        setBalances(bals);
        setBookmakerNames(names);
        const map: Record<string, number | null> = {};
        for (const row of banca.peguei.byBookmaker) map[row.key] = row.profitBRL;
        setProfitByBookmaker(map);
        setBookmakerRows([...banca.peguei.byBookmaker].sort((a, b) => b.profit - a.profit));
        setGroupRows([...banca.peguei.byGroup].sort((a, b) => b.profit - a.profit));
      })
      .catch(() => {
        setTg(NO_TELEGRAM_FOLD);
        setBalances([]);
        setProfitByBookmaker({});
        setBookmakerRows([]);
        setGroupRows([]);
      });
    fetchTelegramTips({ takenStatus: "taken", limit: 1 })
      .then((res) => setTgTipsCount(res.total))
      .catch(() => setTgTipsCount(0));
  }, [canAccess]);

  useEffect(() => {
    if (!canAccess("telegram_banca")) {
      setTelegramSeries([]);
      return;
    }
    const days = chartRange === "all" ? undefined : Number(chartRange);
    fetchTelegramBanca(undefined, days)
      .then((res) => setTelegramSeries(res.series.peguei))
      .catch(() => setTelegramSeries([]));
  }, [chartRange, canAccess]);

  const settled = useMemo(
    () => bets?.filter((b) => b.status === "green" || b.status === "red") ?? null,
    [bets],
  );

  const stats = useMemo(() => {
    if (!settled || !tg || tgTipsCount === null) return null;
    const pnl = settled.reduce((sum, b) => sum + betProfit(b), 0);
    const staked = settled.reduce((sum, b) => sum + Number(b.stakeUnits), 0);
    const greenCount = settled.filter((b) => b.status === "green").length;
    const redCount = settled.length - greenCount;

    // Reembolso não é vitória nem derrota — fora do denominador do winrate.
    const combinedDecided = greenCount + redCount + tg.green + tg.red;
    const combinedGreen = greenCount + tg.green;
    const bancaInicial = tg.bancaInicialUnits ?? STARTING_BANKROLL_UNITS;
    const combinedPnl = pnl + tg.profitUnits;
    const combinedStaked = staked + tg.staked;

    return {
      pnl,
      combinedPnl,
      roi: staked > 0 ? (pnl / staked) * 100 : 0,
      combinedRoi: combinedStaked > 0 ? (combinedPnl / combinedStaked) * 100 : 0,
      hitRate: combinedDecided > 0 ? (combinedGreen / combinedDecided) * 100 : 0,
      staked,
      tipsCount: (bets?.length ?? 0) + tgTipsCount,
      bancaInicial,
      bankroll: bancaInicial + combinedPnl,
      unitValue: tg.unitValue,
    };
  }, [settled, tg, bets, tgTipsCount]);

  // Windowed chart data: native bets are filtered client-side (no server date
  // filter for fetchMyBets), the Telegram half comes straight from
  // fetchTelegramBanca's own `days` param (server-side aggregate, no
  // pagination limit involved). Both are converted to per-event deltas and
  // merged so the existing BankrollChart accumulation logic doesn't change.
  const rangeCutoffMs = useMemo(() => {
    if (chartRange === "all") return null;
    return Date.now() - Number(chartRange) * 86_400_000;
  }, [chartRange]);

  const nativeWindowEvents = useMemo<TimelineEvent[]>(() => {
    if (!settled) return [];
    return settled
      .filter((b) => {
        if (rangeCutoffMs === null) return true;
        return new Date(b.resultSettledAt ?? b.createdAt).getTime() >= rangeCutoffMs;
      })
      .map((b) => ({ date: new Date(b.resultSettledAt ?? b.createdAt).getTime(), profit: betProfit(b) }));
  }, [settled, rangeCutoffMs]);

  const telegramWindowEvents = useMemo<TimelineEvent[]>(() => {
    if (!telegramSeries || telegramSeries.length === 0) return [];
    const sorted = [...telegramSeries].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
    return sorted.map((p, i) => ({
      date: new Date(p.t).getTime(),
      profit: i === 0 ? p.profit : p.profit - sorted[i - 1]!.profit,
    }));
  }, [telegramSeries]);

  const windowTimeline = useMemo<TimelineEvent[]>(
    () => [...nativeWindowEvents, ...telegramWindowEvents],
    [nativeWindowEvents, telegramWindowEvents],
  );

  const chartStartValue = useMemo(() => {
    if (!stats) return 0;
    if (chartRange === "all") return stats.bancaInicial;
    const windowProfit = windowTimeline.reduce((sum, e) => sum + e.profit, 0);
    return stats.bankroll - windowProfit;
  }, [stats, chartRange, windowTimeline]);

  const availableBookmakers = useMemo(
    () => bookmakerNames.filter((name) => !balances.some((b) => b.bookmaker === name)),
    [bookmakerNames, balances],
  );

  async function saveUnitValue(raw: string) {
    const value = raw.trim() === "" ? null : Number(raw.replace(",", "."));
    if (value !== null && (Number.isNaN(value) || value <= 0)) {
      setEditingUnitValue(false);
      return;
    }
    setSavingBalances(true);
    try {
      const saved = await saveTelegramSettings({ unitValue: value });
      setUnitValueRaw(saved.unitValue != null ? String(saved.unitValue) : "");
      setTg((prev) => (prev ? { ...prev, unitValue: saved.unitValue } : prev));
    } finally {
      setSavingBalances(false);
      setEditingUnitValue(false);
    }
  }

  async function persistBalances(next: TelegramBookmakerBalance[]) {
    setBalances(next);
    setSavingBalances(true);
    try {
      await saveBookmakerBalances(next);
    } finally {
      setSavingBalances(false);
    }
  }

  function addBalance() {
    const bookmaker = (newBookmaker === OTHER_OPTION ? customBookmaker : newBookmaker).trim();
    if (!bookmaker || newBalance.trim() === "") return;
    const next = [...balances, { bookmaker, balance: Number(newBalance.replace(",", ".")) }];
    setNewBookmaker("");
    setCustomBookmaker("");
    setNewBalance("");
    setAddingBookmaker(false);
    void persistBalances(next);
  }

  function removeBalance(bookmaker: string) {
    void persistBalances(balances.filter((b) => b.bookmaker !== bookmaker));
  }

  function saveEditedBalance(bookmaker: string, raw: string) {
    setEditingBookmaker(null);
    const trimmed = raw.trim().replace(",", ".");
    if (trimmed === "") return;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return;
    const current = balances.find((b) => b.bookmaker === bookmaker);
    if (current && current.balance === value) return;
    const next = balances.map((b) => (b.bookmaker === bookmaker ? { ...b, balance: value } : b));
    void persistBalances(next);
  }

  if (!me) return null;

  const hasTelegram = canAccess("telegram_banca");

  return (
    <div className="pb-6 lg:max-w-[1180px] lg:pl-6 lg:pr-6 lg:pt-6">
      {/* ---------- Desktop ---------- */}
      <div className="hidden lg:block">
        <div className="mb-6 flex items-center gap-3">
          <span className="text-[22px] font-bold tracking-[-0.02em]">Meu Perfil</span>
          <div className="ml-auto flex items-center gap-3">
            {me.role === "admin" && (
              <Link
                to="/admin"
                className="rounded-[11px] border border-vip-border bg-vip-soft px-4 py-2 text-[13px] font-semibold text-vip"
              >
                Painel
              </Link>
            )}
            <Link
              to="/profile/edit"
              className="rounded-[11px] border border-border-strong px-4 py-2 text-[13px] font-semibold text-text"
            >
              Editar perfil
            </Link>
            <Link to="/new-tip" className="rounded-[11px] bg-accent px-4 py-2 text-[13px] font-semibold text-[#08090A]">
              Publicar tip
            </Link>
          </div>
        </div>

        <div className="mb-6 flex items-center gap-4.5">
          <Avatar name={me.displayName} seed={me.id} src={me.avatarUrl} size={72} />
          <div>
            <div className="text-[22px] font-bold">{me.displayName}</div>
            <div className="font-mono text-[13px] text-text-tertiary">@{me.username}</div>
            {me.bio && <p className="mt-1 max-w-lg text-[13px] text-text-secondary">{me.bio}</p>}
          </div>
        </div>

        {stats && (
          <>
            <div className="mb-6 grid grid-cols-6 gap-4">
              <div className="rounded-2xl border border-border bg-surface p-4.5">
                <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">BANCA INICIAL</div>
                <div className="font-mono text-[26px] font-bold">{stats.bancaInicial.toFixed(1)}u</div>
                {stats.unitValue != null && (
                  <div className="mt-0.5 font-mono text-[11px] text-text-tertiary">
                    {brl(stats.bancaInicial * stats.unitValue)}
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4.5">
                <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">BANCA ATUAL</div>
                <div className={`font-mono text-[26px] font-bold ${stats.bankroll >= stats.bancaInicial ? "text-accent" : "text-live"}`}>
                  {stats.bankroll.toFixed(1)}u
                </div>
                {stats.unitValue != null && (
                  <div className="mt-0.5 font-mono text-[11px] text-text-tertiary">
                    {brl(stats.bankroll * stats.unitValue)}
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4.5">
                <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">LUCRO</div>
                <div className={`font-mono text-[26px] font-bold ${stats.combinedPnl >= 0 ? "text-accent" : "text-live"}`}>
                  {stats.combinedPnl >= 0 ? "+" : ""}
                  {stats.combinedPnl.toFixed(1)}u
                </div>
                {stats.unitValue != null && (
                  <div className="mt-0.5 font-mono text-[11px] text-text-tertiary">
                    {stats.combinedPnl >= 0 ? "+" : ""}
                    {brl(stats.combinedPnl * stats.unitValue)}
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4.5">
                <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">WINRATE</div>
                <div className="font-mono text-[26px] font-bold">{stats.hitRate.toFixed(0)}%</div>
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4.5">
                <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">TIPS PEGAS</div>
                <div className="font-mono text-[26px] font-bold">{stats.tipsCount}</div>
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4.5">
                <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">ROI</div>
                <div className={`font-mono text-[26px] font-bold ${stats.combinedRoi >= 0 ? "text-accent" : "text-live"}`}>
                  {stats.combinedRoi >= 0 ? "+" : ""}
                  {stats.combinedRoi.toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="flex gap-6">
              <div className="min-w-0 flex-1 rounded-2xl border border-border bg-surface p-[22px]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[14px] font-bold">Evolução da banca</span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] text-text-tertiary">
                      {stats.combinedPnl >= 0 ? "+" : ""}
                      {stats.combinedPnl.toFixed(1)}u desde o início
                    </span>
                    <Link to="/telegram-tips/relatorio" className="font-mono text-[11px] text-accent">
                      ver detalhes →
                    </Link>
                  </div>
                </div>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-1.5 rounded-[12px] bg-surface-alt p-1">
                    {RANGE_OPTIONS.map((r) => (
                      <button
                        key={r.key}
                        onClick={() => setChartRange(r.key)}
                        className={`rounded-[9px] px-3 py-1 font-mono text-[11px] font-semibold ${
                          chartRange === r.key ? "bg-accent text-[#08090A]" : "text-text-secondary"
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  {stats.unitValue != null && (
                    <div className="flex gap-1.5 rounded-[12px] bg-surface-alt p-1">
                      {(["u", "brl"] as const).map((u) => (
                        <button
                          key={u}
                          onClick={() => setChartUnit(u)}
                          className={`rounded-[9px] px-3 py-1 font-mono text-[11px] font-semibold ${
                            chartUnit === u ? "bg-accent text-[#08090A]" : "text-text-secondary"
                          }`}
                        >
                          {u === "u" ? "u" : "R$"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <BankrollChart
                  timeline={windowTimeline}
                  startValue={chartStartValue}
                  referenceValue={stats.bancaInicial}
                  unitValue={stats.unitValue}
                  displayUnit={stats.unitValue != null ? chartUnit : "u"}
                />

                {hasTelegram && (bookmakerRows.length > 0 || groupRows.length > 0) && (
                  <div className="mt-6 grid grid-cols-2 gap-5 border-t border-border pt-5">
                    <ProfitRankList
                      title="CASAS DE APOSTAS · POR LUCRO"
                      rows={bookmakerRows}
                      unitValue={stats.unitValue}
                      displayUnit={stats.unitValue != null ? chartUnit : "u"}
                      labelFor={bookmakerLabel}
                      dotFor={bookmakerColor}
                    />
                    <ProfitRankList
                      title="GRUPOS · POR LUCRO"
                      rows={groupRows}
                      unitValue={stats.unitValue}
                      displayUnit={stats.unitValue != null ? chartUnit : "u"}
                    />
                  </div>
                )}
              </div>

              {hasTelegram && (
                <div className="w-[500px] flex-none rounded-2xl border border-border bg-surface p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-[14px] font-bold">Unidade & saldos</span>
                    <div className="flex items-center gap-2">
                      {savingBalances && <span className="text-[11px] text-text-tertiary">salvando…</span>}
                      <button
                        onClick={() => setAddingBookmaker((v) => !v)}
                        className="flex items-center gap-1 rounded-[10px] border border-border-strong px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary"
                      >
                        <IconPlus size={12} />
                        casa
                      </button>
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="mb-1 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">VALOR DA UNIDADE</div>
                    {editingUnitValue ? (
                      <input
                        autoFocus
                        defaultValue={unitValueRaw}
                        inputMode="decimal"
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) => void saveUnitValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditingUnitValue(false);
                        }}
                        className="w-full rounded-[10px] border border-border-strong bg-surface-chip px-3 py-2 text-[13px]"
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[18px] font-bold">
                          {unitValueRaw.trim() !== "" ? brl(Number(unitValueRaw.replace(",", "."))) : "—"}
                        </span>
                        <button onClick={() => setEditingUnitValue(true)} className="text-[11px] font-semibold text-accent">
                          editar
                        </button>
                      </div>
                    )}
                  </div>

                  {addingBookmaker && (
                    <div className="mb-4 flex items-center gap-1.5 rounded-[10px] border border-border-subtle bg-surface-chip p-2">
                      <select
                        value={newBookmaker}
                        onChange={(e) => setNewBookmaker(e.target.value)}
                        className="min-w-0 flex-1 rounded-[8px] border border-border-strong bg-surface px-2 py-1.5 text-[12px]"
                      >
                        <option value="" disabled>
                          Escolha a casa
                        </option>
                        {availableBookmakers.map((name) => (
                          <option key={name} value={name}>
                            {bookmakerLabel(name)}
                          </option>
                        ))}
                        <option value={OTHER_OPTION}>+ Outra casa…</option>
                      </select>
                      {newBookmaker === OTHER_OPTION && (
                        <input
                          value={customBookmaker}
                          onChange={(e) => setCustomBookmaker(e.target.value)}
                          placeholder="Nome"
                          className="w-20 flex-none rounded-[8px] border border-border-strong bg-surface px-2 py-1.5 text-[12px]"
                        />
                      )}
                      <input
                        value={newBalance}
                        onChange={(e) => setNewBalance(e.target.value)}
                        inputMode="decimal"
                        placeholder="Saldo"
                        className="w-16 flex-none rounded-[8px] border border-border-strong bg-surface px-2 py-1.5 text-[12px]"
                      />
                      <button
                        onClick={addBalance}
                        className="flex h-7 w-7 flex-none items-center justify-center rounded-[8px] bg-accent text-[#08090A]"
                        aria-label="Adicionar casa"
                      >
                        <IconPlus size={14} />
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-[minmax(140px,1fr)_92px_190px] gap-2 px-1 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">
                    <span>CASA</span>
                    <span className="text-right">SALDO</span>
                    <span className="text-right">VARIAÇÃO</span>
                  </div>

                  <div className="flex flex-col">
                    {balances.map((b) => {
                      const profit = profitByBookmaker?.[b.bookmaker] ?? null;
                      const current = b.balance + (profit ?? 0);
                      const isEditing = editingBookmaker === b.bookmaker;
                      return (
                        <div
                          key={b.bookmaker}
                          className="group grid grid-cols-[minmax(140px,1fr)_92px_190px] items-center gap-2 border-b border-border-subtle py-2.5 px-1 last:border-0"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={`h-2 w-2 flex-none rounded-full ${bookmakerColor(b.bookmaker)}`} />
                            <span className="min-w-[64px] truncate text-[12.5px] font-semibold">{bookmakerLabel(b.bookmaker)}</span>
                            <button
                              onClick={() => removeBalance(b.bookmaker)}
                              aria-label="Remover"
                              className="ml-auto flex-none text-text-tertiary opacity-0 group-hover:opacity-100"
                            >
                              <IconX size={11} />
                            </button>
                          </div>
                          <div className="text-right font-mono text-[12.5px] font-bold">{brl(current)}</div>
                          <div className="text-right">
                            {isEditing ? (
                              <input
                                autoFocus
                                defaultValue={String(b.balance)}
                                inputMode="decimal"
                                onFocus={(e) => e.currentTarget.select()}
                                onBlur={(e) => saveEditedBalance(b.bookmaker, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.currentTarget.blur();
                                  if (e.key === "Escape") setEditingBookmaker(null);
                                }}
                                className="w-24 rounded bg-surface-chip px-1 py-0.5 text-right font-mono text-[11px] outline-none"
                              />
                            ) : (
                              <button
                                onClick={() => setEditingBookmaker(b.bookmaker)}
                                className="inline-flex items-center gap-1 font-mono text-[11px]"
                              >
                                {profit !== null && profit !== 0 && (
                                  <span className={profit > 0 ? "text-accent" : "text-live"}>
                                    {profit > 0 ? "+" : ""}
                                    {brl(profit)} de{" "}
                                  </span>
                                )}
                                <span className="text-text-tertiary">{brl(b.balance)}</span>
                                <IconPencil size={10} className="text-text-quaternary" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {balances.length === 0 && (
                      <p className="py-4 text-center text-[12px] text-text-tertiary">Nenhuma casa cadastrada ainda.</p>
                    )}
                  </div>

                  {balances.length > 0 && (
                    <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
                      <span className="font-mono text-[11px] text-text-tertiary">
                        TOTAL · {balances.length} casa{balances.length !== 1 ? "s" : ""}
                      </span>
                      <div className="text-right">
                        <div className="font-mono text-[14px] font-bold">
                          {brl(balances.reduce((sum, b) => sum + b.balance + (profitByBookmaker?.[b.bookmaker] ?? 0), 0))}
                        </div>
                        {(() => {
                          const totalProfit = balances.reduce((sum, b) => sum + (profitByBookmaker?.[b.bookmaker] ?? 0), 0);
                          return (
                            <div className={`font-mono text-[11px] font-semibold ${totalProfit >= 0 ? "text-accent" : "text-live"}`}>
                              {totalProfit >= 0 ? "+" : ""}
                              {brl(totalProfit)} de lucro
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </>
        )}
      </div>

      {/* ---------- Mobile ---------- */}
      <div className="lg:hidden">
      <div className="flex items-center gap-3.5 px-5 pb-4 pt-3">
        <Avatar name={me.displayName} seed={me.id} src={me.avatarUrl} size={62} />
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-bold">{me.displayName}</div>
          <div className="font-mono text-[11px] text-text-tertiary">@{me.username}</div>
        </div>
        <Link
          to="/profile/edit"
          className="flex-none rounded-[11px] border border-border-strong px-3.5 py-2 text-[13px] font-semibold text-text-secondary"
        >
          Editar perfil
        </Link>
        <AccountMenu />
      </div>

      {me.bio && <p className="px-5 pb-4 text-[14px] text-text-muted">{me.bio}</p>}

      {stats && (
        <div className="mx-4 mb-4 rounded-2xl border border-border bg-surface p-4">
          <div className="mb-1 text-[13px] text-text-secondary">Resultado das tips que peguei</div>
          <div
            className={`font-mono text-[30px] font-bold ${stats.pnl >= 0 ? "text-accent" : "text-live"}`}
          >
            {stats.pnl >= 0 ? "+" : ""}
            {stats.pnl.toFixed(1)}u
          </div>
          <div className="mt-3 flex gap-4 border-t border-border pt-3">
            <div>
              <div className="font-mono text-[16px] font-bold text-accent">
                {stats.roi >= 0 ? "+" : ""}
                {stats.roi.toFixed(0)}%
              </div>
              <div className="text-[10px] text-text-tertiary">ROI</div>
            </div>
            <div>
              <div className="font-mono text-[16px] font-bold">{stats.hitRate.toFixed(0)}%</div>
              <div className="text-[10px] text-text-tertiary">ACERTO</div>
            </div>
            <div>
              <div className="font-mono text-[16px] font-bold">{stats.staked}u</div>
              <div className="text-[10px] text-text-tertiary">APOSTADO</div>
            </div>
          </div>
        </div>
      )}

      <div className="border-b border-border px-5 pb-2 text-[14px] font-semibold">
        <span className="border-b-2 border-accent pb-2">Minhas apostas</span>
      </div>

      <div className="flex flex-col gap-2.5 px-4 pt-3.5 lg:grid lg:grid-cols-2 lg:gap-3">
        {bets === null && (
          <p className="py-8 text-center text-sm text-text-tertiary lg:col-span-2">Carregando…</p>
        )}
        {bets?.length === 0 && (
          <p className="py-8 text-center text-sm text-text-tertiary lg:col-span-2">
            Você ainda não pegou nenhuma tip.
          </p>
        )}
        {bets?.map((bet) => {
          const result = resultLabel[bet.status] ?? resultLabel.pending!;
          return (
            <div
              key={bet.id}
              className="flex items-center justify-between rounded-2xl border border-border bg-surface p-3.5"
            >
              <div>
                <div className="font-mono text-[10px] text-text-tertiary">
                  {bet.match.league.toUpperCase()}
                </div>
                <div className="text-[14px] font-semibold">
                  {bet.match.homeTeam} x {bet.match.awayTeam} · {bet.market}
                </div>
                <span
                  className={`flex items-center gap-1 font-mono text-[10px] ${result.className}`}
                >
                  {result.Icon && <result.Icon size={10} />}
                  {result.text}
                </span>
              </div>
              <div className="text-right">
                <div className="font-mono text-[18px] font-bold text-accent">
                  {formatOdds(bet.odds)}
                </div>
                <div className="font-mono text-[10px] text-text-tertiary">
                  {formatUnits(bet.stakeUnits)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
