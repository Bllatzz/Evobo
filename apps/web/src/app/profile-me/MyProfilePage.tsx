import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMyBets, type ProfileTip } from "../../lib/profile";
import { formatOdds, formatUnits } from "../../lib/format";
import { Avatar } from "../../components/Avatar";
import { AccountMenu } from "../../components/AccountMenu";
import { useAuth } from "../../stores/auth";
import { IconCheck, IconX } from "../../components/Icon";
import { TelegramBancaOverview } from "../telegram-tips/TelegramBancaOverview";
import {
  fetchTelegramSettings,
  fetchBookmakerBalances,
  fetchTelegramBanca,
  fetchTelegramTips,
  type TelegramTip,
} from "../../lib/telegramTips";

const resultLabel: Record<string, { text: string; className: string; Icon?: typeof IconCheck }> = {
  green: { text: "Green", className: "text-accent", Icon: IconCheck },
  red: { text: "Red", className: "text-live", Icon: IconX },
  void: { text: "Anulada", className: "text-text-tertiary" },
  reembolso: { text: "Reembolso", className: "text-text-tertiary" },
  pending: { text: "Em aberto", className: "text-text-tertiary" },
};

const STARTING_BANKROLL_UNITS = 10;

function betProfit(tip: ProfileTip): number {
  const odds = Number(tip.odds);
  const stake = Number(tip.stakeUnits);
  if (tip.status === "green") return stake * (odds - 1);
  if (tip.status === "red") return -stake;
  return 0;
}

function telegramTipProfit(tip: TelegramTip): number {
  const unit = tip.unit ?? 0;
  if (tip.result === "green") return tip.odd ? unit * (tip.odd - 1) : 0;
  if (tip.result === "red") return -unit;
  return 0; // reembolso — nem ganho nem perda
}

type TimelineEvent = { date: number; profit: number };

/** Real cumulative bankroll evolution (starting banca inicial + running pnl),
 * native bets and Telegram taken tips merged into one chronological line —
 * same non-fabricated approach as the Gráfico Robô wallet chart. */
function BankrollChart({ timeline, startValue }: { timeline: TimelineEvent[]; startValue: number }) {
  const chronological = [...timeline].sort((a, b) => a.date - b.date);
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
  const min = Math.min(startValue, ...values);
  const max = Math.max(startValue, ...values);
  const span = max - min || 1;
  const width = 600;
  const height = 140;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPoints = `0,${height} ${points.join(" ")} ${width},${height}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <defs>
        <linearGradient id="bankrollFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.4" className="text-accent" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" className="text-accent" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#bankrollFill)" />
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="text-accent" />
    </svg>
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

export function MyProfilePage() {
  const { me, canAccess } = useAuth();
  const [bets, setBets] = useState<ProfileTip[] | null>(null);
  const [tg, setTg] = useState<TelegramFold | null>(null);
  const [tgTips, setTgTips] = useState<TelegramTip[] | null>(null);

  const load = useCallback(() => {
    fetchMyBets().then(setBets);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!canAccess("telegram_banca")) {
      setTg(NO_TELEGRAM_FOLD);
      setTgTips([]);
      return;
    }
    Promise.all([fetchTelegramSettings(), fetchBookmakerBalances(), fetchTelegramBanca()])
      .then(([settings, balances, banca]) => {
        const unitValue = settings.unitValue;
        const depositedTotal = balances.reduce((sum, b) => sum + b.balance, 0);
        const peguei = banca.totals.peguei;
        setTg({
          bancaInicialUnits: unitValue && unitValue > 0 ? depositedTotal / unitValue : null,
          unitValue,
          profitUnits: peguei?.profit ?? 0,
          staked: peguei?.staked ?? 0,
          green: peguei?.green ?? 0,
          red: peguei?.red ?? 0,
        });
      })
      .catch(() => setTg(NO_TELEGRAM_FOLD));
    fetchTelegramTips({ takenStatus: "taken", limit: 100 })
      .then((res) => setTgTips(res.data))
      .catch(() => setTgTips([]));
  }, [canAccess]);

  const settled = useMemo(
    () => bets?.filter((b) => b.status === "green" || b.status === "red") ?? null,
    [bets],
  );

  const timeline = useMemo<TimelineEvent[] | null>(() => {
    if (!settled || !tgTips) return null;
    const native = settled.map((b) => ({
      date: new Date(b.resultSettledAt ?? b.createdAt).getTime(),
      profit: betProfit(b),
    }));
    const telegram = tgTips
      .filter((t) => t.result === "green" || t.result === "red")
      .map((t) => ({ date: new Date(t.receivedAt).getTime(), profit: telegramTipProfit(t) }));
    return [...native, ...telegram];
  }, [settled, tgTips]);

  const recentItems = useMemo(() => {
    if (!bets || !tgTips) return null;
    const native = bets.map((b) => ({
      key: `native-${b.id}`,
      title: `${b.match.homeTeam} · ${b.market}`,
      subtitle: `Stake ${formatUnits(b.stakeUnits)}`,
      status: b.status as string,
      date: new Date(b.resultSettledAt ?? b.createdAt).getTime(),
    }));
    const telegram = tgTips.map((t) => ({
      key: `tg-${t.id}`,
      title: t.match ?? t.groupName,
      subtitle: `${t.unit != null ? `${t.unit}u` : "—"} · ${t.bookmaker ?? "—"}`,
      status: t.result as string,
      date: new Date(t.receivedAt).getTime(),
    }));
    return [...native, ...telegram].sort((a, b) => b.date - a.date).slice(0, 6);
  }, [bets, tgTips]);

  const stats = useMemo(() => {
    if (!settled || !tg || !tgTips) return null;
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
      tipsCount: (bets?.length ?? 0) + tgTips.length,
      bancaInicial,
      bankroll: bancaInicial + combinedPnl,
      unitValue: tg.unitValue,
    };
  }, [settled, tg, bets, tgTips]);

  if (!me) return null;

  return (
    <div className="pb-6 lg:mx-auto lg:max-w-[900px] lg:px-0 lg:pt-6">
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
            <div className="mb-6 grid grid-cols-5 gap-4">
              <div className="rounded-2xl border border-border bg-surface p-4.5">
                <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">BANCA INICIAL</div>
                <div className="font-mono text-[26px] font-bold">{stats.bancaInicial.toFixed(1)}u</div>
                {stats.unitValue != null && (
                  <div className="mt-0.5 font-mono text-[11px] text-text-tertiary">
                    {(stats.bancaInicial * stats.unitValue).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
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
                    {(stats.bankroll * stats.unitValue).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
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
                <div className="mb-5 flex items-center justify-between">
                  <span className="text-[14px] font-bold">Evolução da banca</span>
                  <span className="font-mono text-[11px] text-text-tertiary">
                    {stats.combinedPnl >= 0 ? "+" : ""}
                    {stats.combinedPnl.toFixed(1)}u desde o início
                  </span>
                </div>
                <BankrollChart timeline={timeline ?? []} startValue={stats.bancaInicial} />
              </div>

              <div className="w-[320px] flex-none rounded-2xl border border-border bg-surface p-5">
                <div className="mb-4 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
                  TIPS RECENTES
                </div>
                <div className="flex flex-col">
                  {(recentItems ?? []).map((item) => {
                    const result = resultLabel[item.status] ?? resultLabel.pending!;
                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between border-b border-border-subtle py-3 last:border-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold">{item.title}</div>
                          <div className="truncate font-mono text-[11px] text-text-tertiary">{item.subtitle}</div>
                        </div>
                        <span className={`flex-none rounded-lg border px-2 py-1 font-mono text-[10px] font-bold ${result.className} border-current/40`}>
                          {result.text.toUpperCase()}
                        </span>
                      </div>
                    );
                  })}
                  {recentItems?.length === 0 && (
                    <p className="py-4 text-center text-[12px] text-text-tertiary">
                      Você ainda não pegou nenhuma tip.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {canAccess("telegram_banca") && <TelegramBancaOverview />}
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
