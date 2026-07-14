import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchRobotSignals,
  fetchRobotPerformanceSummary,
  type RobotSignal,
  type RobotPerformanceSummary,
  type StatPair,
} from "../../lib/robot";
import { formatOdds } from "../../lib/format";
import {
  IconRobotMonitor,
  IconTrophy,
  IconPennant,
  IconCornerFlag,
  IconFire,
  IconClockStat,
  IconTarget,
  IconPossession,
  IconGauge,
  IconExternalLink,
  IconLive,
} from "../../components/Icon";
import { RobotTabs } from "./RobotTabs";

const filters = [
  { key: "escanteios", label: "Escanteios", match: (m: string) => /escanteio|corner/i.test(m) },
  { key: "cartoes", label: "Cartões", match: (m: string) => /cart[aã]o|card/i.test(m) },
  { key: "gols", label: "Gols", match: (m: string) => /gol|goal/i.test(m) },
  { key: "todos", label: "Todos", match: () => true },
] as const;

// The backend only pulls corners bots for now (gols/cartões aren't vetted yet — see
// robot-signals/routes.ts), so those chips would just always be empty. Hidden, not
// deleted, so re-enabling later is a one-line change back to `filters`.
const visibleFilters = filters.filter((f) => f.key === "escanteios");

/** Amarelos/Vermelhos render as a small colored card rectangle, not an icon — matches the design exactly. */
function CardSwatch({ color }: { color: string }) {
  return <span className={`h-3 w-2 flex-none rounded-[2px] ${color}`} />;
}

const statRows: {
  key: keyof RobotSignal["stats"];
  label: string;
  icon: React.ReactNode;
  format?: (pair: StatPair) => string;
}[] = [
  {
    key: "dangerousAttacks",
    label: "At. perigosos",
    icon: <IconFire size={12} className="flex-none text-orange" />,
  },
  {
    key: "apMin5",
    label: "AP/min 5m",
    icon: <IconFire size={12} className="flex-none text-orange" />,
  },
  { key: "yellow", label: "Amarelos", icon: <CardSwatch color="bg-vip" /> },
  { key: "red", label: "Vermelhos", icon: <CardSwatch color="bg-live" /> },
  {
    key: "shotsOff",
    label: "Chutes fora",
    icon: <IconClockStat size={12} className="flex-none text-text-secondary" />,
  },
  {
    key: "shotsOn",
    label: "Chutes alvo",
    icon: <IconTarget size={12} className="flex-none text-verified" />,
  },
  {
    key: "possession",
    label: "Posse",
    icon: <IconPossession size={12} className="flex-none text-text-secondary" />,
    format: (p) => `${p.home}% – ${p.away}%`,
  },
];

function StatValue({ pair, format }: { pair: StatPair; format?: (p: StatPair) => string }) {
  return <>{format ? format(pair) : `${pair.home ?? "—"} – ${pair.away ?? "—"}`}</>;
}

/** Desktop (D4) shows a fixed 4-cell grid — Escanteios is always the first cell regardless of
 * market, unlike the mobile card's dynamic highlightStat treatment — and drops the full stat list,
 * the pennant icon, and the date from the competition row. */
function DesktopRobotCard({ signal }: { signal: RobotSignal }) {
  const corners = signal.stats.corners ?? { home: null, away: null };
  const dangerous = signal.stats.dangerousAttacks;

  return (
    <div className="rounded-[18px] border border-border bg-surface p-4">
      <div className="mb-3 flex min-w-0 items-center gap-2">
        <IconTrophy size={16} className="flex-none text-vip" />
        <span className="truncate text-[14px] font-semibold">{signal.market}</span>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[16px] font-bold">
          {signal.homeTeam} <span className="text-text-quaternary">×</span> {signal.awayTeam}
        </div>
        <Link
          to={`/robot/market/${encodeURIComponent(signal.marketGroupKey)}`}
          className="flex-none font-mono text-[11px] text-accent"
        >
          Gráfico ›
        </Link>
      </div>

      <div className="mb-2 flex items-center gap-3 font-mono">
        <span className="text-[20px] font-bold">
          {signal.scoreHome ?? "-"} – {signal.scoreAway ?? "-"}
        </span>
        {signal.gameMinute != null && (
          <span className="text-[12px] font-semibold text-live">{signal.gameMinute}′</span>
        )}
      </div>

      <div className="mb-3.5 font-mono text-[10px] text-text-tertiary">{signal.competition}</div>

      <div className="mb-3.5 grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-accent-border bg-accent-soft p-2.5">
          <span className="text-[10px] text-text-secondary">Escanteios</span>
          <span className="font-mono text-[15px] font-bold text-accent">
            <StatValue pair={corners} />
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">At. perigosos</span>
          <span className="font-mono text-[15px] font-bold">
            {dangerous ? <StatValue pair={dangerous} /> : "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">Odds aposta</span>
          <span className="font-mono text-[15px] font-bold text-accent">
            {signal.odds ? formatOdds(signal.odds) : "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-accent-border bg-accent-soft p-2.5">
          <span className="flex items-center gap-1 text-[10px] text-text-secondary">
            <IconGauge size={12} />
            Stake sugerido
          </span>
          <span className="font-mono text-[15px] font-bold">{signal.stakeUnits}u</span>
        </div>
      </div>

      {signal.bet365Url && (
        <a
          href={signal.bet365Url}
          target="_blank"
          rel="noreferrer"
          className="flex h-[42px] items-center justify-center gap-1.5 rounded-xl bg-accent text-[14px] font-bold text-[#08090A]"
        >
          Abrir na Bet365 <IconExternalLink size={13} />
        </a>
      )}
    </div>
  );
}

/** Right-side panel on Desktop Robô — real 30-day aggregate performance
 * (GET /robot-signals/performance) plus a static explanation of what bot
 * consensus means for a signal, matching the design's "DESEMPENHO DO
 * ROBÔ · 30D" + "GESTÃO DE BANCA" cards. */
function RobotPerformancePanel({ summary }: { summary: RobotPerformanceSummary | null }) {
  return (
    <aside className="w-[300px] flex-none overflow-y-auto p-6">
      <div className="mb-4 rounded-2xl border border-border bg-surface p-4.5">
        <div className="mb-3.5 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
          DESEMPENHO DO ROBÔ · 30D
        </div>
        <div className="mb-3.5 flex items-center justify-between">
          <span className="text-[13px] text-text-muted">Green</span>
          <span className="font-mono text-[15px] font-bold text-accent">{summary?.green ?? "—"}</span>
        </div>
        <div className="mb-3.5 flex items-center justify-between">
          <span className="text-[13px] text-text-muted">Red</span>
          <span className="font-mono text-[15px] font-bold text-live">{summary?.red ?? "—"}</span>
        </div>
        <div className="mb-3.5 flex items-center justify-between">
          <span className="text-[13px] text-text-muted">Assertividade</span>
          <span className="font-mono text-[15px] font-bold">
            {summary ? `${summary.assertPct}%` : "—"}
          </span>
        </div>
        <div className="mb-3.5 h-px bg-border" />
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-text-muted">ROI</span>
          <span
            className={`font-mono text-[15px] font-bold ${(summary?.roiPct ?? 0) >= 0 ? "text-accent" : "text-live"}`}
          >
            {summary ? `${summary.roiPct >= 0 ? "+" : ""}${summary.roiPct}%` : "—"}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-accent-border bg-gradient-to-br from-[#0F1A14] to-surface p-4.5">
        <div className="mb-3 font-mono text-[11px] tracking-[0.06em] text-accent">GESTÃO DE BANCA</div>
        <div className="text-[13px] leading-relaxed text-text-muted">
          Cada robô tem sua própria unidade de stake sugerida. Quando mais de um robô sinaliza a{" "}
          mesma aposta, as unidades deles se somam no sinal. A{" "}
          <span className="font-semibold text-accent">quantidade</span> de robôs que concordam e a{" "}
          <span className="font-semibold text-accent">qualidade</span> histórica desses robôs mostram
          o quanto o sinal é confiável: quanto mais robôs concordarem, maior a confiança.
        </div>
      </div>
    </aside>
  );
}

export function RobotPage() {
  const [signals, setSignals] = useState<RobotSignal[] | null>(null);
  const [summary, setSummary] = useState<RobotPerformanceSummary | null>(null);
  const [filter, setFilter] = useState<(typeof filters)[number]["key"]>("escanteios");

  useEffect(() => {
    fetchRobotSignals().then(setSignals);
    fetchRobotPerformanceSummary().then(setSummary);
  }, []);

  const filtered = useMemo(() => {
    if (!signals) return null;
    const active = filters.find((f) => f.key === filter)!;
    return signals.filter((s) => active.match(s.market));
  }, [signals, filter]);

  return (
    <>
      {/* Desktop — "D4 · Desktop · Robô" frame: different header copy, no "Todos" filter,
          simplified fixed-stat card grid (2 columns), plus a right-side panel with the
          real 30-day performance summary and the risk→stake explanation. */}
      <div className="hidden h-full lg:flex">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-none items-center gap-3 border-b border-border px-8 py-[18px]">
            <div className="flex items-center gap-2.5">
              <IconRobotMonitor size={24} className="text-accent" />
              <span className="text-[22px] font-bold tracking-[-0.02em]">Robô</span>
            </div>
            <RobotTabs active="tips" />
            <div className="ml-auto flex items-center gap-3">
              {signals && (
                <span className="flex items-center gap-1.5 font-mono text-[12px] text-accent">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  {signals.length} apostas pendentes
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-8 py-6">
            {filtered === null && (
              <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>
            )}
            {filtered?.length === 0 && (
              <p className="py-10 text-center text-sm text-text-tertiary">
                Nenhuma aposta pendente no momento, só vai aparecer caso tenha alguma pendente.
                <br />
                <Link to="/robot/history" className="font-semibold text-accent">
                  Clique aqui pra ver o histórico
                </Link>
              </p>
            )}
            {filtered && filtered.length > 0 && (
              <div className="grid grid-cols-2 gap-[18px]">
                {filtered.map((signal) => (
                  <DesktopRobotCard key={signal.id} signal={signal} />
                ))}
              </div>
            )}
          </div>
        </div>

        <RobotPerformancePanel summary={summary} />
      </div>

      {/* Mobile — single-column card list, own header copy/filters (see the "01 · Robô" mobile frame). */}
      <div className="pb-6 lg:hidden">
      <div className="flex items-center gap-2 px-5 pb-1 pt-3">
        <IconRobotMonitor size={20} className="text-accent" />
        <span className="text-[20px] font-bold tracking-[-0.02em]">Robô</span>
        {signals && (
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {signals.length} pendentes
          </span>
        )}
      </div>
      <div className="px-5 pb-1 text-[11px] text-text-tertiary">Feed ao vivo · robotip</div>
      <div className="px-5 pb-3">
        <RobotTabs active="tips" />
      </div>

      <div className="flex gap-2 overflow-x-auto px-4 pb-3.5">
        {visibleFilters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex-none rounded-full px-3.5 py-1.5 text-[12px] ${
              filter === f.key ? "bg-accent font-semibold text-[#08090A]" : "bg-surface-alt text-text-secondary"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3.5 px-4">
        {filtered === null && (
          <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>
        )}
        {filtered?.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-text-tertiary">
            Nenhuma aposta pendente no momento, só vai aparecer caso tenha alguma pendente.
            <br />
            <Link to="/robot/history" className="font-semibold text-accent">
              Clique aqui pra ver o histórico
            </Link>
          </p>
        )}
        {filtered?.map((signal) => {
          const corners = signal.stats.corners;
          const highlightCorners = signal.highlightStat === "corners" && corners !== null;

          return (
            <div key={signal.id} className="rounded-[18px] border border-border bg-surface p-3.5">
              <div className="mb-2.5 flex items-center gap-1.5">
                <IconTrophy size={14} className="flex-none text-vip" />
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{signal.market}</span>
              </div>

              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[14px] font-bold">
                  {signal.homeTeam} <span className="text-text-quaternary">×</span> {signal.awayTeam}
                </div>
                <Link
                  to={`/robot/market/${encodeURIComponent(signal.marketGroupKey)}`}
                  className="flex-none font-mono text-[10.5px] text-accent"
                >
                  Gráfico ›
                </Link>
              </div>

              <div className="mb-2.5 flex items-center gap-3 font-mono">
                <span className="text-[18px] font-bold">
                  {signal.scoreHome ?? "-"}–{signal.scoreAway ?? "-"}
                </span>
                {signal.gameMinute != null && (
                  <span className="text-[12px] font-semibold text-live">{signal.gameMinute}'</span>
                )}
                {signal.lastGoalMinute != null && (
                  <span className="flex items-center gap-1 text-[11px] text-text-secondary">
                    <IconClockStat size={12} />
                    {signal.lastGoalMinute}
                  </span>
                )}
              </div>

              <div className="mb-3.5 flex items-center gap-1.5 font-mono text-[10px] text-text-tertiary">
                <IconPennant size={11} className="flex-none text-accent" />
                {signal.competition} ·{" "}
                {new Date(signal.receivedAt).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>

              <div className="mb-3.5 grid grid-cols-2 gap-1.5">
                {highlightCorners && (
                  <div className="col-span-2 flex items-center justify-between gap-2 rounded-lg border border-accent-border bg-accent-soft px-2.5 py-2">
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold">
                      <IconCornerFlag size={14} className="flex-none text-accent" />
                      Escanteios
                      {signal.lastCornerMinute != null && (
                        <span className="font-mono text-[10px] text-text-tertiary">
                          {signal.lastCornerMinute}'
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-[14px] font-bold text-accent">
                      <StatValue pair={corners!} />
                    </span>
                  </div>
                )}

                {!highlightCorners && corners && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-surface-chip px-2.5 py-2">
                    <IconCornerFlag size={12} className="flex-none text-accent" />
                    <span className="flex-1 truncate text-[10.5px] text-text-secondary">Escanteios</span>
                    <span className="font-mono text-[12px] font-bold">
                      <StatValue pair={corners} />
                    </span>
                  </div>
                )}

                {statRows
                  .map((row) => ({ row, pair: signal.stats[row.key] }))
                  .filter(({ pair }) => pair != null)
                  .map(({ row, pair }) => (
                    <div
                      key={row.key}
                      className="flex items-center gap-1.5 rounded-lg bg-surface-chip px-2.5 py-2"
                    >
                      {row.icon}
                      <span className="flex-1 truncate text-[10.5px] text-text-secondary">
                        {row.label}
                      </span>
                      <span className="font-mono text-[12px] font-bold">
                        <StatValue pair={pair!} format={row.format} />
                      </span>
                    </div>
                  ))}

                {signal.odds && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-surface-chip px-2.5 py-2">
                    <IconLive size={12} className="flex-none text-accent" />
                    <span className="flex-1 truncate text-[10.5px] text-text-secondary">
                      Odds aposta
                    </span>
                    <span className="font-mono text-[12px] font-bold text-accent">
                      {formatOdds(signal.odds)}
                    </span>
                  </div>
                )}

                <div className="col-span-2 flex items-center justify-between gap-2 rounded-lg border border-accent-border bg-accent-soft px-3 py-2.5">
                  <span className="flex items-center gap-1.5 text-[12px] font-semibold text-text">
                    <IconGauge size={14} />
                    Stake sugerido
                  </span>
                  <span className="font-mono text-[16px] font-bold">{signal.stakeUnits}u</span>
                </div>
              </div>

              {signal.bet365Url && (
                <a
                  href={signal.bet365Url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-accent text-[13.5px] font-bold text-[#08090A]"
                >
                  Abrir na Bet365 <IconExternalLink size={13} />
                </a>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </>
  );
}
