import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMyBets, type ProfileTip } from "../../lib/profile";
import { formatOdds, formatUnits } from "../../lib/format";
import { Avatar } from "../../components/Avatar";
import { AccountMenu } from "../../components/AccountMenu";
import { useAuth } from "../../stores/auth";
import { IconCheck, IconX } from "../../components/Icon";

const resultLabel: Record<string, { text: string; className: string; Icon?: typeof IconCheck }> = {
  green: { text: "Green", className: "text-accent", Icon: IconCheck },
  red: { text: "Red", className: "text-live", Icon: IconX },
  void: { text: "Anulada", className: "text-text-tertiary" },
  pending: { text: "Em aberto", className: "text-text-tertiary" },
};

const STARTING_BANKROLL_UNITS = 10;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function betProfit(tip: ProfileTip): number {
  const odds = Number(tip.odds);
  const stake = Number(tip.stakeUnits);
  if (tip.status === "green") return stake * (odds - 1);
  if (tip.status === "red") return -stake;
  return 0;
}

/** Real cumulative bankroll evolution (starting bankroll + running pnl), chronological — same non-fabricated approach as the Gráfico Robô wallet chart. */
function BankrollChart({ settled }: { settled: ProfileTip[] }) {
  const chronological = [...settled].sort(
    (a, b) => new Date(a.resultSettledAt ?? a.createdAt).getTime() - new Date(b.resultSettledAt ?? b.createdAt).getTime(),
  );
  if (chronological.length < 2) {
    return (
      <div className="flex h-[140px] items-center justify-center text-[12px] text-text-tertiary">
        Poucas apostas resolvidas para desenhar o gráfico.
      </div>
    );
  }

  let cumulative = STARTING_BANKROLL_UNITS;
  const values = chronological.map((tip) => {
    cumulative += betProfit(tip);
    return cumulative;
  });
  const min = Math.min(STARTING_BANKROLL_UNITS, ...values);
  const max = Math.max(STARTING_BANKROLL_UNITS, ...values);
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

export function MyProfilePage() {
  const { me } = useAuth();
  const [bets, setBets] = useState<ProfileTip[] | null>(null);

  const load = useCallback(() => {
    fetchMyBets().then(setBets);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const settled = useMemo(
    () => bets?.filter((b) => b.status === "green" || b.status === "red") ?? null,
    [bets],
  );

  const stats = useMemo(() => {
    if (!settled) return null;
    const pnl = settled.reduce((sum, b) => sum + betProfit(b), 0);
    const staked = settled.reduce((sum, b) => sum + Number(b.stakeUnits), 0);
    const greenCount = settled.filter((b) => b.status === "green").length;

    const recentCutoff = Date.now() - THIRTY_DAYS_MS;
    const recent = settled.filter((b) => new Date(b.resultSettledAt ?? b.createdAt).getTime() >= recentCutoff);
    const recentStaked = recent.reduce((sum, b) => sum + Number(b.stakeUnits), 0);
    const recentPnl = recent.reduce((sum, b) => sum + betProfit(b), 0);

    return {
      pnl,
      roi: staked > 0 ? (pnl / staked) * 100 : 0,
      roi30d: recentStaked > 0 ? (recentPnl / recentStaked) * 100 : 0,
      hitRate: settled.length > 0 ? (greenCount / settled.length) * 100 : 0,
      staked,
      bankroll: STARTING_BANKROLL_UNITS + pnl,
    };
  }, [settled]);

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
            <div className="mb-6 grid grid-cols-4 gap-4">
              <div className="rounded-2xl border border-border bg-surface p-4.5">
                <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">ROI 30D</div>
                <div className={`font-mono text-[26px] font-bold ${stats.roi30d >= 0 ? "text-accent" : "text-live"}`}>
                  {stats.roi30d >= 0 ? "+" : ""}
                  {stats.roi30d.toFixed(1)}%
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4.5">
                <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">WINRATE</div>
                <div className="font-mono text-[26px] font-bold">{stats.hitRate.toFixed(0)}%</div>
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4.5">
                <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">TIPS PEGAS</div>
                <div className="font-mono text-[26px] font-bold">{bets?.length ?? 0}</div>
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4.5">
                <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">BANCA ATUAL</div>
                <div className={`font-mono text-[26px] font-bold ${stats.bankroll >= STARTING_BANKROLL_UNITS ? "text-accent" : "text-live"}`}>
                  {stats.bankroll.toFixed(1)}u
                </div>
              </div>
            </div>

            <div className="flex gap-6">
              <div className="min-w-0 flex-1 rounded-2xl border border-border bg-surface p-[22px]">
                <div className="mb-5 flex items-center justify-between">
                  <span className="text-[14px] font-bold">Evolução da banca</span>
                  <span className="font-mono text-[11px] text-text-tertiary">
                    {stats.pnl >= 0 ? "+" : ""}
                    {stats.pnl.toFixed(1)}u desde o início
                  </span>
                </div>
                <BankrollChart settled={settled ?? []} />
              </div>

              <div className="w-[320px] flex-none rounded-2xl border border-border bg-surface p-5">
                <div className="mb-4 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
                  TIPS RECENTES
                </div>
                <div className="flex flex-col">
                  {(bets ?? []).slice(0, 6).map((bet) => {
                    const result = resultLabel[bet.status] ?? resultLabel.pending!;
                    return (
                      <div
                        key={bet.id}
                        className="flex items-center justify-between border-b border-border-subtle py-3 last:border-0"
                      >
                        <div>
                          <div className="text-[13px] font-semibold">
                            {bet.match.homeTeam} · {bet.market}
                          </div>
                          <div className="font-mono text-[11px] text-text-tertiary">
                            Stake {formatUnits(bet.stakeUnits)}
                          </div>
                        </div>
                        <span className={`rounded-lg border px-2 py-1 font-mono text-[10px] font-bold ${result.className} border-current/40`}>
                          {result.text.toUpperCase()}
                        </span>
                      </div>
                    );
                  })}
                  {bets?.length === 0 && (
                    <p className="py-4 text-center text-[12px] text-text-tertiary">
                      Você ainda não pegou nenhuma tip.
                    </p>
                  )}
                </div>
              </div>
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
