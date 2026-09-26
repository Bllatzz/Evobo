import { useCallback, useEffect, useMemo, useState, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { fetchMyBets, type ProfileTip } from "../../lib/profile";
import { formatOdds, formatUnits } from "../../lib/format";
import { Avatar } from "../../components/Avatar";
import { AccountMenu } from "../../components/AccountMenu";
import { useAuth } from "../../stores/auth";
import { bookmakerLabel } from "../../lib/bookmakers";
import { IconCheck, IconX, IconPlus } from "../../components/Icon";
import { fetchAutoBetSettings } from "../../lib/autoBetting";
import {
  fetchTelegramSettings,
  saveTelegramSettings,
  fetchBookmakerBalances,
  saveBookmakerBalances,
  fetchBookmakerNames,
  fetchTelegramBanca,
  fetchTelegramTips,
  fetchWithdrawals,
  createWithdrawal,
  deleteWithdrawal,
  type TelegramBookmakerBalance,
  type TelegramBookmakerWithdrawal,
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

type TimelineEvent = { date: number; profit: number; withdrawal?: boolean };

/** "YYYY-MM-DD" de hoje em São Paulo (UTC-3 fixo). */
const todaySaoPaulo = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
/** Meio-dia em São Paulo do dia do saque — o gráfico só precisa do dia. */
const withdrawalTime = (w: TelegramBookmakerWithdrawal) => new Date(`${w.withdrawnAt}T12:00:00-03:00`).getTime();
const formatDay = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(2, 4)}`;
type SeriesPoint = TelegramBancaSummary["series"]["peguei"][number];

const RANGE_OPTIONS = [
  { key: "7", label: "7d" },
  { key: "30", label: "30d" },
  { key: "90", label: "90d" },
  { key: "all", label: "tudo" },
] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];

const DAY_MS = 24 * 60 * 60 * 1000;

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

  function handleMove(e: PointerEvent<SVGSVGElement>) {
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

  // Robot chart (WalletChart) reveals the date only on hover; here the window can
  // span months, so once it covers more than a day we print a permanent day axis
  // below the plot instead, picked at evenly spaced indices (same index→x mapping
  // the polyline itself uses, so each label lines up under its point).
  const spanMs = chronological[chronological.length - 1]!.date - chronological[0]!.date;
  const showDayAxis = spanMs > DAY_MS;
  const dayLabelCount = Math.min(6, values.length);
  const dayLabels = showDayAxis
    ? Array.from(
        new Set(
          Array.from({ length: dayLabelCount }, (_, k) =>
            Math.round((k / (dayLabelCount - 1)) * (values.length - 1)),
          ),
        ),
      ).map((index) => ({ index, date: chronological[index]!.date }))
    : [];

  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          preserveAspectRatio="none"
          onPointerMove={handleMove}
          onPointerDown={handleMove}
          onPointerLeave={() => setHoverIndex(null)}
          // pan-y: vertical swipes still scroll the page, horizontal drags scrub the chart.
          style={{ touchAction: "pan-y" }}
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
            className="text-vip/60"
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
          <span
            className="absolute left-1 -translate-y-full rounded bg-surface/80 px-1 font-mono text-[10px] text-vip"
            style={{ top: `${((refY / height) * 100).toFixed(2)}%` }}
          >
            banca inicial {formatValue(referenceValue)}
          </span>
          {/* Saque: ponto azul no degrau — HTML (não <circle>) porque o svg
              estica sem manter proporção e o círculo viraria elipse. */}
          {chronological.map((e, i) =>
            e.withdrawal ? (
              <span
                key={i}
                className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-verified ring-2 ring-surface"
                style={{
                  left: `${(i / (values.length - 1)) * 100}%`,
                  top: `${(((height - ((values[i]! - min) / span) * height) / height) * 100).toFixed(2)}%`,
                }}
              />
            ) : null,
          )}
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
            {hovered.withdrawal && <div className="text-verified">saque</div>}
          </div>
        )}
      </div>
      {showDayAxis && (
        <div className="relative mt-1.5 h-3.5">
          {dayLabels.map(({ index, date }, k) => (
            <span
              key={index}
              className="absolute font-mono text-[10px] text-text-tertiary"
              style={{
                left: `${(index / (values.length - 1)) * 100}%`,
                transform: k === 0 ? "translateX(0)" : k === dayLabels.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {new Date(date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
            </span>
          ))}
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
  unitValue: number | null;
  profitUnits: number;
  staked: number;
  green: number;
  red: number;
  // Peguei mas o resultado oficial ainda não saiu — dinheiro travado em
  // apostas em aberto, que nunca entra em profitUnits/staked (ver /banca).
  abertoUnits: number;
  abertoCount: number;
};
const NO_TELEGRAM_FOLD: TelegramFold = {
  unitValue: null,
  profitUnits: 0,
  staked: 0,
  green: 0,
  red: 0,
  abertoUnits: 0,
  abertoCount: 0,
};

// Casas (D29 · "Meu perfil v3 · unificado"): o que era "Unidade & saldos" e
// a tabela de lucro por casa viraram uma linha só por casa — apostas, lucro,
// ROI, depositado, sacado e saldo lado a lado.
// Cabeçalho clicável: clicar ordena pela coluna, clicar de novo inverte.
const CASA_COLUMNS = [
  { key: "name", label: "CASA" },
  { key: "total", label: "APOSTAS" },
  { key: "profit", label: "LUCRO" },
  { key: "roiPct", label: "ROI" },
  { key: "deposited", label: "DEPOSITADO" },
  { key: "withdrawn", label: "SACADO" },
  { key: "saldo", label: "SALDO" },
] as const;
type CasaSortKey = (typeof CASA_COLUMNS)[number]["key"];
type SortDir = "asc" | "desc";
type ProfileTab = "casas" | "grupos" | "saques";

type CasaRow = {
  key: string;
  total: number;
  profit: number;
  staked: number;
  roiPct: number | null;
  deposited: number | null;
  withdrawn: number;
  saldo: number | null;
};

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthYear = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]}/${d.getFullYear()}`;
};

/** "1.234,56" — valor em R$ sem o prefixo, como as colunas da tabela de casas. */
const plainBrl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedUnits = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}u`;
const signedPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

function SegmentedButtons<K extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="flex gap-[3px] rounded-[9px] border border-border bg-surface-alt p-[3px]">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`rounded-[7px] px-2.5 py-[5px] font-mono text-[11px] lg:px-[11px] ${
            value === opt.key ? "bg-accent font-bold text-[#08090A]" : "text-text-secondary"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function MyProfilePage() {
  const { me, session, canAccess } = useAuth();
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

  // Saques: tiram do saldo da casa e da banca atual, nunca do lucro.
  const [withdrawals, setWithdrawals] = useState<TelegramBookmakerWithdrawal[]>([]);
  const [tab, setTab] = useState<ProfileTab>("casas");
  const [casaSort, setCasaSort] = useState<{ key: CasaSortKey; dir: SortDir }>({ key: "profit", dir: "desc" });
  const [autoBetEnabled, setAutoBetEnabled] = useState<boolean | null>(null);
  const [withdrawalBookmaker, setWithdrawalBookmaker] = useState("");
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [withdrawalDate, setWithdrawalDate] = useState(todaySaoPaulo);
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null);

  // Casas e grupos de todo o período (não seguem o filtro do gráfico): o
  // saldo de cada casa é de todo o período, então o lucro ao lado também.
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
      setWithdrawals([]);
      setBookmakerNames([]);
      setProfitByBookmaker({});
      setBookmakerRows([]);
      setGroupRows([]);
      return;
    }
    Promise.all([fetchTelegramSettings(), fetchBookmakerBalances(), fetchTelegramBanca(), fetchBookmakerNames()])
      .then(([settings, bals, banca, names]) => {
        const unitValue = settings.unitValue;
        const peguei = banca.totals.peguei;
        setTg({
          unitValue,
          profitUnits: peguei?.profit ?? 0,
          staked: peguei?.staked ?? 0,
          green: peguei?.green ?? 0,
          red: peguei?.red ?? 0,
          abertoUnits: banca.aberto.units,
          abertoCount: banca.aberto.count,
        });
        setUnitValueRaw(unitValue != null ? String(unitValue) : "");
        setBalances(bals);
        setBookmakerNames(names);
        const map: Record<string, number | null> = {};
        for (const row of banca.peguei.byBookmaker) map[row.key] = row.profitBRL;
        setProfitByBookmaker(map);
        setBookmakerRows(banca.peguei.byBookmaker);
        setGroupRows([...banca.peguei.byGroup].sort((a, b) => b.profit - a.profit));
      })
      .catch(() => {
        setTg(NO_TELEGRAM_FOLD);
        setBalances([]);
        setProfitByBookmaker({});
      });
    fetchWithdrawals()
      .then(setWithdrawals)
      .catch(() => setWithdrawals([]));
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

  // Chip "Aposta automática ligada" no cabeçalho — a tela é só de admin por enquanto.
  useEffect(() => {
    if (me?.role !== "admin") return;
    fetchAutoBetSettings()
      .then((s) => setAutoBetEnabled(s.enabled))
      .catch(() => setAutoBetEnabled(null));
  }, [me?.role]);

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
    // Derived here, not stored at load: it depends on the deposits (`balances`)
    // and the unit value, both of which the user edits on this very page — a
    // value computed once at load stayed stale until the next reload.
    const depositedTotal = balances.reduce((sum, b) => sum + b.balance, 0);
    const bancaInicial = tg.unitValue && tg.unitValue > 0 ? depositedTotal / tg.unitValue : STARTING_BANKROLL_UNITS;
    const combinedPnl = pnl + tg.profitUnits;
    const combinedStaked = staked + tg.staked;
    // Sem valor da unidade não dá pra converter R$ em u — o saque só aparece nas casas.
    const withdrawnTotal = withdrawals.reduce((sum, w) => sum + w.amount, 0);
    const withdrawnUnits = tg.unitValue && tg.unitValue > 0 ? withdrawnTotal / tg.unitValue : 0;

    return {
      pnl,
      combinedPnl,
      roi: staked > 0 ? (pnl / staked) * 100 : 0,
      combinedRoi: combinedStaked > 0 ? (combinedPnl / combinedStaked) * 100 : 0,
      hitRate: combinedDecided > 0 ? (combinedGreen / combinedDecided) * 100 : 0,
      staked,
      tipsCount: (bets?.length ?? 0) + tgTipsCount,
      bancaInicial,
      bankroll: bancaInicial + combinedPnl - withdrawnUnits,
      withdrawnTotal,
      withdrawnUnits,
      unitValue: tg.unitValue,
      abertoUnits: tg.abertoUnits,
      abertoCount: tg.abertoCount,
    };
  }, [settled, tg, bets, tgTipsCount, balances, withdrawals]);

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

  // Saque = degrau pra baixo no gráfico, no dia em que foi feito.
  const withdrawalWindowEvents = useMemo<TimelineEvent[]>(() => {
    const unitValue = tg?.unitValue;
    if (!unitValue || unitValue <= 0) return [];
    return withdrawals
      .map((w) => ({ date: withdrawalTime(w), profit: -w.amount / unitValue, withdrawal: true }))
      .filter((e) => rangeCutoffMs === null || e.date >= rangeCutoffMs);
  }, [withdrawals, tg, rangeCutoffMs]);

  const windowTimeline = useMemo<TimelineEvent[]>(
    () => [...nativeWindowEvents, ...telegramWindowEvents, ...withdrawalWindowEvents],
    [nativeWindowEvents, telegramWindowEvents, withdrawalWindowEvents],
  );

  const chartStartValue = useMemo(() => {
    if (!stats) return 0;
    if (chartRange === "all") return stats.bancaInicial;
    const windowProfit = windowTimeline.reduce((sum, e) => sum + e.profit, 0);
    return stats.bankroll - windowProfit;
  }, [stats, chartRange, windowTimeline]);

  const withdrawnByBookmaker = useMemo(() => {
    const map: Record<string, number> = {};
    for (const w of withdrawals) map[w.bookmaker] = (map[w.bookmaker] ?? 0) + w.amount;
    return map;
  }, [withdrawals]);

  const casaRows = useMemo<CasaRow[]>(() => {
    const byKey = new Map(bookmakerRows.map((r) => [r.key, r]));
    const keys = [...new Set([...balances.map((b) => b.bookmaker), ...bookmakerRows.map((r) => r.key)])];
    const rows = keys.map((key) => {
      const row = byKey.get(key);
      const deposited = balances.find((b) => b.bookmaker === key)?.balance ?? null;
      const withdrawn = withdrawnByBookmaker[key] ?? 0;
      return {
        key,
        total: row?.total ?? 0,
        profit: row?.profit ?? 0,
        staked: row?.staked ?? 0,
        roiPct: row?.roiPct ?? null,
        deposited,
        withdrawn,
        saldo: deposited === null ? null : deposited + (profitByBookmaker?.[key] ?? 0) - withdrawn,
      };
    });
    const { key, dir } = casaSort;
    const sign = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (key === "name") return sign * bookmakerLabel(a.key).localeCompare(bookmakerLabel(b.key), "pt-BR");
      const va = a[key];
      const vb = b[key];
      // Sem valor ("—") fica sempre no fim, nos dois sentidos.
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
      return sign * (va - vb);
    });
    return rows;
  }, [bookmakerRows, balances, withdrawnByBookmaker, profitByBookmaker, casaSort]);

  const casaTotals = useMemo(() => {
    const profit = casaRows.reduce((sum, r) => sum + r.profit, 0);
    const staked = casaRows.reduce((sum, r) => sum + r.staked, 0);
    return {
      total: casaRows.reduce((sum, r) => sum + r.total, 0),
      profit,
      roiPct: staked > 0 ? (profit / staked) * 100 : null,
      deposited: casaRows.reduce((sum, r) => sum + (r.deposited ?? 0), 0),
      withdrawn: casaRows.reduce((sum, r) => sum + r.withdrawn, 0),
      saldo: casaRows.reduce((sum, r) => sum + (r.saldo ?? 0), 0),
    };
  }, [casaRows]);

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
    const previous = balances;
    setBalances(next);
    setSavingBalances(true);
    try {
      await saveBookmakerBalances(next);
    } catch {
      // The server refused it: don't keep showing a balance that isn't saved.
      setBalances(previous);
    } finally {
      setSavingBalances(false);
    }
  }

  function addBalance() {
    const bookmaker = (newBookmaker === OTHER_OPTION ? customBookmaker : newBookmaker).trim();
    const value = Number(newBalance.trim().replace(",", "."));
    // Text or a negative amount is ignored — Number("abc") is NaN, which used
    // to be sent to the server and shown as "R$ NaN".
    if (!bookmaker || newBalance.trim() === "" || !Number.isFinite(value) || value < 0) return;
    const sameCasa = (name: string) => name.toLowerCase() === bookmaker.toLowerCase();
    // A casa typed again (any casing) updates the saved balance instead of
    // adding a duplicate row.
    const next = balances.some((b) => sameCasa(b.bookmaker))
      ? balances.map((b) => (sameCasa(b.bookmaker) ? { ...b, balance: value } : b))
      : [...balances, { bookmaker, balance: value }];
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
    // Casa que só tinha tips pegas (sem depósito lançado) ganha a linha aqui.
    const next = current
      ? balances.map((b) => (b.bookmaker === bookmaker ? { ...b, balance: value } : b))
      : [...balances, { bookmaker, balance: value }];
    void persistBalances(next);
  }

  async function addWithdrawal() {
    const amount = Number(withdrawalAmount.trim().replace(",", "."));
    if (!withdrawalBookmaker || !Number.isFinite(amount) || amount <= 0 || !withdrawalDate) {
      setWithdrawalError("Escolha a casa, o valor e a data.");
      return;
    }
    setWithdrawalError(null);
    setSavingBalances(true);
    try {
      const saved = await createWithdrawal({ bookmaker: withdrawalBookmaker, amount, withdrawnAt: withdrawalDate });
      setWithdrawals((prev) => [saved, ...prev].sort((a, b) => b.withdrawnAt.localeCompare(a.withdrawnAt)));
      setWithdrawalAmount("");
      setWithdrawalDate(todaySaoPaulo());
    } catch {
      setWithdrawalError("Não consegui salvar o saque.");
    } finally {
      setSavingBalances(false);
    }
  }

  async function removeWithdrawal(id: string) {
    const previous = withdrawals;
    setWithdrawals(previous.filter((w) => w.id !== id));
    try {
      await deleteWithdrawal(id);
    } catch {
      setWithdrawals(previous);
    }
  }

  function openSaques(bookmaker?: string) {
    setTab("saques");
    setWithdrawalError(null);
    const target = bookmaker ?? (withdrawalBookmaker || balances[0]?.bookmaker || "");
    if (target !== withdrawalBookmaker) {
      setWithdrawalBookmaker(target);
      setWithdrawalAmount("");
    }
  }

  if (!me) return null;

  const hasTelegram = canAccess("telegram_banca");
  const memberSince = session?.user.created_at ? monthYear(session.user.created_at) : null;
  const casaGrid =
    "grid grid-cols-[minmax(0,1fr)_70px_86px_86px_100px_90px_110px_64px] items-center gap-3.5 px-4 lg:px-[22px]";

  const selectedCasa = casaRows.find((r) => r.key === withdrawalBookmaker) ?? null;
  const withdrawalValue = Number(withdrawalAmount.trim().replace(",", "."));
  const withdrawalPreview = Number.isFinite(withdrawalValue) && withdrawalValue > 0 ? withdrawalValue : 0;

  const unitChip = hasTelegram && (
    <span className="flex h-[34px] flex-none items-center gap-2 rounded-[10px] border border-border bg-surface-alt px-3 text-[12px]">
      <span className="font-mono text-[11px] text-text-tertiary">1u =</span>
      {editingUnitValue ? (
        <input
          autoFocus
          defaultValue={unitValueRaw}
          inputMode="decimal"
          aria-label="Valor da unidade"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => void saveUnitValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditingUnitValue(false);
          }}
          className="w-20 rounded-[6px] bg-surface-chip px-1.5 py-0.5 font-mono text-[12px] outline-none"
        />
      ) : (
        <>
          <span className="font-mono font-bold">
            {unitValueRaw.trim() !== "" ? brl(Number(unitValueRaw.replace(",", "."))) : "—"}
          </span>
          <button onClick={() => setEditingUnitValue(true)} className="text-[11px] text-accent">
            {unitValueRaw.trim() !== "" ? "editar" : "definir"}
          </button>
        </>
      )}
      {savingBalances && <span className="text-[10px] text-text-tertiary">salvando…</span>}
    </span>
  );

  const autoBetChip = me.role === "admin" && autoBetEnabled !== null && (
    <Link
      to="/auto-betting"
      className="flex h-[34px] flex-none items-center gap-2 rounded-[10px] border border-border bg-surface-alt px-3 text-[12px] text-text-muted"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${autoBetEnabled ? "bg-accent" : "bg-text-quaternary"}`} />
      Aposta automática {autoBetEnabled ? "ligada" : "desligada"}
      <span className="text-text-tertiary">›</span>
    </Link>
  );

  const eqLabel = "mb-2 font-mono text-[10px] tracking-[0.05em] text-text-tertiary";
  const eqSub = "mt-[3px] font-mono text-[11px] text-text-tertiary";
  const eqOp = "hidden flex-none px-[18px] font-mono text-[20px] text-text-quaternary/50 lg:block";
  const tabClass = (key: ProfileTab) =>
    `-mb-px border-b-2 py-4 text-[13px] ${key === tab ? "border-accent font-bold" : "border-transparent text-text-secondary"}`;

  return (
    <div className="w-full pb-24 lg:px-[30px] lg:pb-[30px] lg:pt-[26px]">
      {/* ---------- Cabeçalho: avatar, chips de unidade/aposta automática e ações ---------- */}
      <div className="flex flex-wrap items-center gap-3 px-5 pb-4 pt-3 lg:mb-[18px] lg:flex-nowrap lg:gap-4 lg:p-0">
        <Avatar name={me.displayName} seed={me.id} src={me.avatarUrl} size={56} />
        <div className="min-w-0 flex-1 lg:flex-none">
          <div className="truncate text-[18px] font-bold tracking-[-0.02em] lg:text-[22px]">{me.displayName}</div>
          <div className="mt-[3px] truncate font-mono text-[11px] text-text-tertiary lg:text-[12px]">
            @{me.username}
            {memberSince && ` · desde ${memberSince}`}
          </div>
        </div>
        <div className="flex items-center gap-2 lg:hidden">
          <Link
            to="/profile/edit"
            className="flex-none rounded-[11px] border border-border-strong px-3.5 py-2 text-[13px] font-semibold text-text-secondary"
          >
            Editar perfil
          </Link>
          <AccountMenu />
        </div>
        {(unitChip || autoBetChip) && (
          <div className="flex w-full flex-wrap items-center gap-2 lg:ml-3.5 lg:w-auto lg:flex-nowrap lg:gap-2.5">
            {unitChip}
            {autoBetChip}
          </div>
        )}
        <div className="ml-auto hidden items-center gap-2.5 lg:flex">
          {me.role === "admin" && (
            <Link
              to="/admin"
              className="flex h-[38px] items-center rounded-[11px] border border-vip-border bg-vip-soft px-[15px] text-[13px] font-semibold text-vip"
            >
              Painel
            </Link>
          )}
          <Link
            to="/profile/edit"
            className="flex h-[38px] items-center rounded-[11px] border border-border-strong px-[15px] text-[13px] font-semibold text-text"
          >
            Editar perfil
          </Link>
          <Link
            to="/new-tip"
            className="flex h-[38px] items-center rounded-[11px] bg-accent px-4 text-[13px] font-bold text-[#08090A]"
          >
            Publicar tip
          </Link>
        </div>
        {me.bio && <p className="w-full text-[14px] text-text-muted lg:hidden">{me.bio}</p>}
      </div>

      {stats && (
        <div className="mx-4 flex flex-col gap-4 lg:mx-0 lg:gap-[18px]">
          {/* ---------- Banca inicial + lucro − sacado = banca atual ---------- */}
          <section className="overflow-hidden rounded-[18px] border border-border bg-surface">
            <div className="grid grid-cols-3 gap-3 p-4 lg:flex lg:items-center lg:gap-0 lg:px-6 lg:py-5">
              <div className="min-w-0 lg:flex-1">
                <div className={eqLabel}>BANCA INICIAL</div>
                <div className="font-mono text-[17px] font-bold text-text-muted lg:text-[22px]">{stats.bancaInicial.toFixed(1)}u</div>
                {stats.unitValue != null && <div className={eqSub}>{brl(stats.bancaInicial * stats.unitValue)}</div>}
              </div>
              <span className={eqOp}>+</span>
              <div className="min-w-0 lg:flex-1">
                <div className={eqLabel}>LUCRO</div>
                <div className={`font-mono text-[17px] font-bold lg:text-[22px] ${stats.combinedPnl >= 0 ? "text-accent" : "text-live"}`}>
                  {stats.combinedPnl < 0 && "−"}
                  {Math.abs(stats.combinedPnl).toFixed(1)}u
                </div>
                {stats.unitValue != null && <div className={eqSub}>{brl(stats.combinedPnl * stats.unitValue)}</div>}
              </div>
              <span className={eqOp}>−</span>
              <div className="min-w-0 lg:flex-1">
                <div className={eqLabel}>SACADO</div>
                <div className="font-mono text-[17px] font-bold text-verified lg:text-[22px]">{stats.withdrawnUnits.toFixed(1)}u</div>
                <div className={eqSub}>{brl(stats.withdrawnTotal)}</div>
              </div>
              <span className={eqOp}>=</span>
              <div className="order-first col-span-3 min-w-0 rounded-[14px] border border-accent-border bg-accent-soft px-[18px] py-3.5 lg:order-none lg:flex-[1.3]">
                <div className="mb-1.5 font-mono text-[10px] tracking-[0.05em] text-accent">BANCA ATUAL</div>
                <div className="font-mono text-[28px] font-bold tracking-[-0.02em]">
                  {stats.bankroll.toFixed(1)}
                  <span className="text-[17px] text-text-secondary">u</span>
                </div>
                {stats.unitValue != null && (
                  <div className="mt-0.5 font-mono text-[11px] text-text-secondary">{brl(stats.bankroll * stats.unitValue)}</div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 border-t border-border-subtle lg:grid-cols-5">
              {[
                {
                  label: "ROI",
                  value: signedPct(stats.combinedRoi),
                  className: stats.combinedRoi >= 0 ? "text-accent" : "text-live",
                },
                { label: "WINRATE", value: `${stats.hitRate.toFixed(0)}%` },
                { label: "TIPS PEGAS", value: String(stats.tipsCount) },
                {
                  // Tudo que a banca já chegou a ter: o que entrou + o que ganhou,
                  // antes de tirar os saques.
                  label: "LUCRO TOTAL",
                  value: `${(stats.bancaInicial + stats.combinedPnl).toFixed(1)}u`,
                  className: "text-accent",
                  sub:
                    stats.unitValue != null
                      ? brl((stats.bancaInicial + stats.combinedPnl) * stats.unitValue)
                      : undefined,
                  title: "Banca inicial + lucro (antes dos saques)",
                },
                {
                  label: "EM ABERTO",
                  value: `${stats.abertoUnits.toFixed(1)}u`,
                  className: "text-vip",
                  sub:
                    stats.unitValue != null
                      ? brl(stats.abertoUnits * stats.unitValue)
                      : `${stats.abertoCount} aposta${stats.abertoCount !== 1 ? "s" : ""}`,
                },
              ].map((cell, i, cells) => (
                <div
                  key={cell.label}
                  title={"title" in cell ? cell.title : undefined}
                  className={`flex flex-wrap items-baseline gap-x-2.5 border-border-subtle px-4 py-[13px] lg:px-6 ${
                    i % 2 === 1 ? "border-l" : ""
                  } ${i >= 2 ? "border-t lg:border-t-0" : ""} ${i > 0 ? "lg:border-l" : ""} ${
                    i === cells.length - 1 && cells.length % 2 === 1 ? "col-span-2 lg:col-span-1" : ""
                  }`}
                >
                  <span className="font-mono text-[10px] tracking-[0.05em] text-text-tertiary">{cell.label}</span>
                  <span className={`font-mono text-[15px] font-bold ${cell.className ?? ""}`}>{cell.value}</span>
                  {cell.sub && <span className="font-mono text-[11px] text-text-tertiary">{cell.sub}</span>}
                </div>
              ))}
            </div>
          </section>

          {/* ---------- Evolução da banca ---------- */}
          <section className="rounded-[18px] border border-border bg-surface px-4 pb-3.5 pt-4 lg:px-[22px] lg:pt-[18px]">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="text-[14px] font-bold">Evolução da banca</span>
              {withdrawals.length > 0 && (
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-text-tertiary">
                  <span className="h-2 w-2 rounded-full bg-verified" />
                  saque
                </span>
              )}
              <Link to="/telegram-tips/relatorio" className="font-mono text-[11px] text-accent">
                ver detalhes →
              </Link>
              <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
                <SegmentedButtons options={RANGE_OPTIONS} value={chartRange} onChange={setChartRange} />
                {stats.unitValue != null && (
                  <div className="flex gap-[3px] rounded-[9px] border border-border bg-surface-alt p-[3px]">
                    {(["u", "brl"] as const).map((u) => (
                      <button
                        key={u}
                        onClick={() => setChartUnit(u)}
                        className={`rounded-[7px] px-2.5 py-[5px] font-mono text-[11px] ${
                          chartUnit === u ? "bg-text/10 text-text" : "text-text-secondary"
                        }`}
                      >
                        {u === "u" ? "u" : "R$"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <BankrollChart
              timeline={windowTimeline}
              startValue={chartStartValue}
              referenceValue={stats.bancaInicial}
              unitValue={stats.unitValue}
              displayUnit={stats.unitValue != null ? chartUnit : "u"}
            />
          </section>

          {/* ---------- Casas · Grupos · Saques ---------- */}
          {hasTelegram && (
            <section className="overflow-hidden rounded-[18px] border border-border bg-surface">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border-subtle px-4 lg:px-[22px]">
                <button onClick={() => setTab("casas")} className={tabClass("casas")}>
                  Casas <span className="font-mono font-medium text-text-tertiary">{casaRows.length}</span>
                </button>
                <button onClick={() => setTab("grupos")} className={tabClass("grupos")}>
                  Grupos <span className="font-mono font-medium text-text-tertiary">{groupRows.length}</span>
                </button>
                <button onClick={() => openSaques()} className={tabClass("saques")}>
                  Saques <span className="font-mono font-medium text-text-tertiary">{withdrawals.length}</span>
                </button>
                {tab === "casas" && (
                  <div className="ml-auto flex items-center">
                    <button
                      onClick={() => setAddingBookmaker((v) => !v)}
                      className="flex h-8 items-center gap-1.5 rounded-[9px] border border-border-strong px-3 text-[12px] font-semibold"
                    >
                      <IconPlus size={12} />
                      casa
                    </button>
                  </div>
                )}
              </div>

              {tab === "casas" && (
                <>
                  {addingBookmaker && (
                    <div className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-4 py-3 lg:px-[22px]">
                      <select
                        value={newBookmaker}
                        onChange={(e) => setNewBookmaker(e.target.value)}
                        aria-label="Casa"
                        className="min-w-0 flex-1 rounded-[8px] border border-border-strong bg-surface-alt px-2 py-1.5 text-[12px] lg:max-w-[260px]"
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
                          className="w-28 flex-none rounded-[8px] border border-border-strong bg-surface-alt px-2 py-1.5 text-[12px]"
                        />
                      )}
                      <input
                        value={newBalance}
                        onChange={(e) => setNewBalance(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addBalance()}
                        inputMode="decimal"
                        placeholder="Depositado"
                        className="w-28 flex-none rounded-[8px] border border-border-strong bg-surface-alt px-2 py-1.5 text-[12px]"
                      />
                      <button
                        onClick={addBalance}
                        className="flex h-7 flex-none items-center justify-center rounded-[8px] bg-accent px-3 text-[11px] font-semibold text-[#08090A]"
                      >
                        Adicionar
                      </button>
                    </div>
                  )}

                  {casaRows.length === 0 ? (
                    <p className="py-8 text-center text-[12px] text-text-tertiary">Nenhuma casa cadastrada ainda.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <div className="min-w-[860px]">
                        <div
                          className={`${casaGrid} border-b border-border-subtle py-[11px] font-mono text-[12px] font-semibold tracking-[0.05em] text-text-tertiary`}
                        >
                          {CASA_COLUMNS.map((col) => {
                            const active = casaSort.key === col.key;
                            return (
                              <button
                                key={col.key}
                                onClick={() =>
                                  setCasaSort((prev) =>
                                    prev.key === col.key
                                      ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
                                      : { key: col.key, dir: col.key === "name" ? "asc" : "desc" },
                                  )
                                }
                                aria-sort={active ? (casaSort.dir === "asc" ? "ascending" : "descending") : undefined}
                                className={`flex items-center gap-1 tracking-[0.05em] hover:text-text ${
                                  col.key === "name" ? "justify-start" : "justify-end"
                                } ${active ? "text-text" : ""}`}
                              >
                                {col.label}
                                <span className={`text-[10px] ${active ? "text-accent" : "invisible"}`}>
                                  {active && casaSort.dir === "asc" ? "▲" : "▼"}
                                </span>
                              </button>
                            );
                          })}
                          <span />
                        </div>
                        {casaRows.map((c) => {
                          const zerada = c.withdrawn > 0 && c.saldo !== null && Math.abs(c.saldo) < 0.005;
                          return (
                            <div key={c.key} className={`${casaGrid} group border-b border-border-subtle py-2.5`}>
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span className={`h-2 w-2 flex-none rounded-full ${bookmakerColor(c.key)}`} />
                                <span className="truncate text-[13px] font-semibold">{bookmakerLabel(c.key)}</span>
                                {zerada && (
                                  <span className="flex-none rounded-[5px] bg-verified-soft px-1.5 py-0.5 font-mono text-[9px] text-verified">
                                    SACOU TUDO
                                  </span>
                                )}
                                {c.deposited !== null && (
                                  <button
                                    onClick={() => {
                                      if (window.confirm(`Remover ${bookmakerLabel(c.key)} dos saldos?`)) removeBalance(c.key);
                                    }}
                                    aria-label="Remover casa"
                                    className="flex-none text-text-tertiary opacity-0 group-hover:opacity-100"
                                  >
                                    <IconX size={11} />
                                  </button>
                                )}
                              </div>
                              <span className="text-right font-mono text-[12px] text-text-secondary">{c.total}</span>
                              <span className={`text-right font-mono text-[13px] font-bold ${c.profit >= 0 ? "text-accent" : "text-live"}`}>
                                {signedUnits(c.profit)}
                              </span>
                              <span
                                className={`text-right font-mono text-[12px] ${
                                  c.roiPct == null ? "text-text-tertiary" : c.roiPct >= 0 ? "text-accent" : "text-live"
                                }`}
                              >
                                {c.roiPct == null ? "—" : signedPct(c.roiPct)}
                              </span>
                              <div className="text-right">
                                {editingBookmaker === c.key ? (
                                  <input
                                    autoFocus
                                    defaultValue={c.deposited !== null ? String(c.deposited) : ""}
                                    inputMode="decimal"
                                    aria-label="Valor depositado"
                                    onFocus={(e) => e.currentTarget.select()}
                                    onBlur={(e) => saveEditedBalance(c.key, e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") e.currentTarget.blur();
                                      if (e.key === "Escape") setEditingBookmaker(null);
                                    }}
                                    className="w-full rounded bg-surface-alt px-1 py-0.5 text-right font-mono text-[12px] outline-none"
                                  />
                                ) : (
                                  <button
                                    onClick={() => setEditingBookmaker(c.key)}
                                    title="Editar valor depositado"
                                    className="font-mono text-[12px] text-text-secondary hover:text-text"
                                  >
                                    {c.deposited !== null ? plainBrl(c.deposited) : "—"}
                                  </button>
                                )}
                              </div>
                              <span className={`text-right font-mono text-[12px] ${c.withdrawn > 0 ? "text-verified" : "text-text-quaternary/50"}`}>
                                {c.withdrawn > 0 ? plainBrl(c.withdrawn) : "—"}
                              </span>
                              <span
                                className={`text-right font-mono text-[13px] font-bold ${
                                  c.saldo === null ? "text-text-tertiary" : c.saldo < 0 ? "text-live" : ""
                                }`}
                              >
                                {c.saldo === null ? "—" : `${c.saldo < 0 ? "−" : ""}${plainBrl(Math.abs(c.saldo))}`}
                              </span>
                              <button
                                onClick={() => openSaques(c.key)}
                                className={`flex h-7 items-center justify-self-end rounded-[8px] border border-border-strong px-2.5 text-[11px] font-semibold text-text-muted ${
                                  c.saldo !== null && c.saldo > 0 ? "" : "invisible"
                                }`}
                              >
                                sacar
                              </button>
                            </div>
                          );
                        })}
                        <div className={`${casaGrid} border-t border-border bg-surface-chip py-[13px]`}>
                          <span className="font-mono text-[11px] text-text-tertiary">
                            TOTAL · {casaRows.length} casa{casaRows.length !== 1 ? "s" : ""}
                          </span>
                          <span className="text-right font-mono text-[12px] text-text-secondary">{casaTotals.total}</span>
                          <span className={`text-right font-mono text-[13px] font-bold ${casaTotals.profit >= 0 ? "text-accent" : "text-live"}`}>
                            {signedUnits(casaTotals.profit)}
                          </span>
                          <span
                            className={`text-right font-mono text-[12px] font-bold ${
                              casaTotals.roiPct == null ? "text-text-tertiary" : casaTotals.roiPct >= 0 ? "text-accent" : "text-live"
                            }`}
                          >
                            {casaTotals.roiPct == null ? "—" : signedPct(casaTotals.roiPct)}
                          </span>
                          <span className="text-right font-mono text-[12px] text-text-secondary">{plainBrl(casaTotals.deposited)}</span>
                          <span className="text-right font-mono text-[12px] text-verified">{plainBrl(casaTotals.withdrawn)}</span>
                          <span className="text-right font-mono text-[14px] font-bold">{plainBrl(casaTotals.saldo)}</span>
                          <span />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {tab === "grupos" &&
                (groupRows.length === 0 ? (
                  <p className="py-8 text-center text-[12px] text-text-tertiary">Sem dados ainda.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="min-w-[480px]">
                      <div className="grid grid-cols-[minmax(0,1fr)_90px_100px_90px] gap-3.5 border-b border-border-subtle px-4 py-[11px] font-mono text-[10px] tracking-[0.05em] text-text-tertiary lg:px-[22px]">
                        <span>GRUPO</span>
                        <span className="text-right">APOSTAS</span>
                        <span className="text-right">LUCRO</span>
                        <span className="text-right">ROI</span>
                      </div>
                      {groupRows.map((g) => (
                        <div
                          key={g.key}
                          className="grid grid-cols-[minmax(0,1fr)_90px_100px_90px] items-center gap-3.5 border-b border-border-subtle px-4 py-[13px] last:border-0 lg:px-[22px]"
                        >
                          <span className="truncate text-[13px] font-semibold">{g.key}</span>
                          <span className="text-right font-mono text-[12px] text-text-secondary">{g.total}</span>
                          <span className={`text-right font-mono text-[13px] font-bold ${g.profit >= 0 ? "text-accent" : "text-live"}`}>
                            {signedUnits(g.profit)}
                          </span>
                          <span
                            className={`text-right font-mono text-[12px] ${
                              g.roiPct == null ? "text-text-tertiary" : g.roiPct >= 0 ? "text-accent" : "text-live"
                            }`}
                          >
                            {g.roiPct == null ? "—" : signedPct(g.roiPct)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

              {tab === "saques" && (
                <div className="grid lg:grid-cols-[380px_minmax(0,1fr)]">
                  <div className="border-b border-border-subtle px-4 py-5 lg:border-b-0 lg:border-r lg:px-[22px]">
                    <div className="mb-3.5 text-[13px] font-bold">Novo saque</div>
                    {balances.length === 0 ? (
                      <p className="text-[12px] text-text-tertiary">Lance o depósito de uma casa na aba Casas primeiro.</p>
                    ) : (
                      <>
                        <div className="mb-1.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">CASA</div>
                        <div className="mb-3 flex h-[42px] items-center gap-2 rounded-[10px] border border-border-strong bg-surface-alt px-3">
                          {withdrawalBookmaker && (
                            <span className={`h-2 w-2 flex-none rounded-full ${bookmakerColor(withdrawalBookmaker)}`} />
                          )}
                          <select
                            value={withdrawalBookmaker}
                            onChange={(e) => {
                              setWithdrawalBookmaker(e.target.value);
                              setWithdrawalAmount("");
                            }}
                            aria-label="Casa do saque"
                            className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none"
                          >
                            {balances.map((b) => (
                              <option key={b.bookmaker} value={b.bookmaker}>
                                {bookmakerLabel(b.bookmaker)}
                              </option>
                            ))}
                          </select>
                          {selectedCasa?.saldo != null && (
                            <span className="flex-none font-mono text-[11px] text-text-secondary">saldo {brl(selectedCasa.saldo)}</span>
                          )}
                        </div>
                        <div className="mb-3.5 grid grid-cols-[minmax(0,1fr)_130px] gap-2.5">
                          <div>
                            <div className="mb-1.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">VALOR</div>
                            <div className="flex h-[42px] items-center gap-1.5 rounded-[10px] border border-accent bg-surface-alt pl-3 pr-1.5 font-mono text-[14px]">
                              <span className="text-text-tertiary">R$</span>
                              <input
                                value={withdrawalAmount}
                                onChange={(e) => setWithdrawalAmount(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && void addWithdrawal()}
                                inputMode="decimal"
                                placeholder="0,00"
                                aria-label="Valor sacado"
                                className="min-w-0 flex-1 bg-transparent outline-none"
                              />
                              {selectedCasa?.saldo != null && selectedCasa.saldo > 0 && (
                                <button
                                  onClick={() => setWithdrawalAmount(selectedCasa.saldo!.toFixed(2))}
                                  className="flex-none rounded-[6px] border border-accent-border px-[7px] py-1 text-[10px] text-accent"
                                >
                                  tudo
                                </button>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">DATA</div>
                            <input
                              type="date"
                              value={withdrawalDate}
                              max={todaySaoPaulo()}
                              onChange={(e) => setWithdrawalDate(e.target.value)}
                              aria-label="Data do saque"
                              className="h-[42px] w-full rounded-[10px] border border-border-strong bg-surface-alt px-2.5 font-mono text-[12px] text-text-muted"
                            />
                          </div>
                        </div>
                        <div className="mb-3.5 flex flex-col gap-2 rounded-[10px] border border-border-subtle bg-surface-chip px-[13px] py-[11px] text-[11px]">
                          {selectedCasa?.saldo != null && (
                            <div className="flex justify-between gap-2">
                              <span className="text-text-secondary">Saldo {bookmakerLabel(selectedCasa.key)}</span>
                              <span className="font-mono">
                                {brl(selectedCasa.saldo)} → <b>{brl(selectedCasa.saldo - withdrawalPreview)}</b>
                              </span>
                            </div>
                          )}
                          {stats.unitValue != null && stats.unitValue > 0 && (
                            <div className="flex justify-between gap-2">
                              <span className="text-text-secondary">Banca atual</span>
                              <span className="font-mono">
                                {stats.bankroll.toFixed(1)}u → <b>{(stats.bankroll - withdrawalPreview / stats.unitValue).toFixed(1)}u</b>
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between gap-2">
                            <span className="text-text-secondary">Lucro e ROI</span>
                            <span className="font-mono text-accent">não mudam</span>
                          </div>
                        </div>
                        {withdrawalError && <p className="mb-2 text-[11px] text-live">{withdrawalError}</p>}
                        <button
                          onClick={() => void addWithdrawal()}
                          disabled={savingBalances}
                          className="flex h-[42px] w-full items-center justify-center rounded-[10px] bg-accent text-[13px] font-bold text-[#08090A] disabled:opacity-60"
                        >
                          Confirmar saque
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex flex-col px-4 py-5 lg:px-[22px]">
                    <div className="flex items-baseline justify-between border-b border-border-subtle pb-[9px]">
                      <span className="font-mono text-[10px] tracking-[0.05em] text-text-tertiary">HISTÓRICO</span>
                      <span className="font-mono text-[13px] font-bold text-verified">{brl(stats.withdrawnTotal)}</span>
                    </div>
                    {withdrawals.length === 0 && <p className="py-4 text-[12px] text-text-tertiary">Nenhum saque lançado.</p>}
                    {withdrawals.map((w) => (
                      <div key={w.id} className="flex items-center gap-3 border-b border-border-subtle px-0.5 py-[13px]">
                        <span className="w-16 flex-none font-mono text-[11px] text-text-tertiary">{formatDay(w.withdrawnAt)}</span>
                        <span className={`h-2 w-2 flex-none rounded-full ${bookmakerColor(w.bookmaker)}`} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{bookmakerLabel(w.bookmaker)}</span>
                        <span className="font-mono text-[13px] font-bold">{brl(w.amount)}</span>
                        <button
                          onClick={() => {
                            if (window.confirm(`Apagar o saque de ${brl(w.amount)} (${formatDay(w.withdrawnAt)})?`)) void removeWithdrawal(w.id);
                          }}
                          className="text-[11px] text-text-tertiary hover:text-live"
                        >
                          apagar
                        </button>
                      </div>
                    ))}
                    <p className="max-w-[420px] pt-3.5 text-[11px] leading-[1.55] text-text-tertiary">
                      Saque tira dinheiro da banca, mas não conta como perda. Lucro da casa = saldo + sacado − depositado.
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
      {!stats && <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>}

      {/* ---------- Mobile: native (non-Telegram) bets, only when there are any ---------- */}
      {bets && bets.length > 0 && (
        <div className="mt-6 lg:hidden">
          <div className="border-b border-border px-5 pb-2 text-[14px] font-semibold">
            <span className="border-b-2 border-accent pb-2">Minhas apostas</span>
          </div>
          <div className="flex flex-col gap-2.5 px-4 pt-3.5">
            {bets.map((bet) => {
              const result = resultLabel[bet.status] ?? resultLabel.pending!;
              return (
                <div
                  key={bet.id}
                  className="flex items-center justify-between rounded-2xl border border-border bg-surface p-3.5"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] text-text-tertiary">
                      {bet.match.league.toUpperCase()}
                    </div>
                    <div className="text-[14px] font-semibold">
                      {bet.match.homeTeam} x {bet.match.awayTeam} · {bet.market}
                    </div>
                    <span className={`flex items-center gap-1 font-mono text-[10px] ${result.className}`}>
                      {result.Icon && <result.Icon size={10} />}
                      {result.text}
                    </span>
                  </div>
                  <div className="flex-none pl-3 text-right">
                    <div className="font-mono text-[18px] font-bold text-accent">{formatOdds(bet.odds)}</div>
                    <div className="font-mono text-[10px] text-text-tertiary">{formatUnits(bet.stakeUnits)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
