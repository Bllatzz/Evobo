import { useEffect, useState, type MouseEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchMarketPerformance, type BotOperation, type MarketPerformance } from "../../lib/robot";
import { formatOdds } from "../../lib/format";
import { IconChevronLeft, IconRobotMonitor, IconX } from "../../components/Icon";
import { Logo } from "../../components/Logo";
import { RobotTabs } from "./RobotTabs";

const RESULT_STYLE: Record<BotOperation["result"], { label: string; className: string }> = {
  green: { label: "Green", className: "bg-accent-soft text-accent" },
  red: { label: "Red", className: "bg-live/10 text-live" },
  reembolso: { label: "Reemb.", className: "bg-vip/10 text-vip" },
};

/** Inline SVG polyline — matches the design's own mini-chart approach, no charting lib in the project. */
function WalletChart({ operations, height }: { operations: BotOperation[]; height: number }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chronological = [...operations].reverse();
  if (chronological.length < 2) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-[12px] text-text-tertiary"
      >
        Poucas operações para desenhar o gráfico.
      </div>
    );
  }

  const values = chronological.map((op) => op.cumulativeProfit);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const width = 600;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const areaPoints = `0,${height} ${points.join(" ")} ${width},${height}`;

  function handleMove(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    const index = Math.round(fraction * (values.length - 1));
    setHoverIndex(Math.min(values.length - 1, Math.max(0, index)));
  }

  const hovered = hoverIndex !== null ? chronological[hoverIndex] : null;
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
          <linearGradient id="walletFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.4" className="text-accent" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" className="text-accent" />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill="url(#walletFill)" />
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-accent"
        />
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
      {hovered && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-border bg-surface-alt px-2.5 py-1.5 font-mono text-[11px] shadow-lg"
          style={{
            left: tooltipAlign === "center" ? `${tooltipLeftPct}%` : tooltipAlign === "left" ? "0%" : undefined,
            right: tooltipAlign === "right" ? "0%" : undefined,
            transform: tooltipAlign === "center" ? "translateX(-50%)" : undefined,
          }}
        >
          <div className="text-text-tertiary">{new Date(hovered.date).toLocaleDateString("pt-BR")}</div>
          <div className={`font-bold ${hovered.cumulativeProfit >= 0 ? "text-accent" : "text-live"}`}>
            {hovered.cumulativeProfit >= 0 ? "+" : ""}
            {hovered.cumulativeProfit}%
          </div>
        </div>
      )}
    </div>
  );
}

function StatRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle py-3 last:border-0">
      <span className="text-[13px] text-text-secondary">{label}</span>
      <span className={`font-mono text-[13px] font-bold ${className ?? ""}`}>{value}</span>
    </div>
  );
}

export function MarketChartPage() {
  const { groupKey = "" } = useParams<{ groupKey: string }>();
  const navigate = useNavigate();
  const [perf, setPerf] = useState<MarketPerformance | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [oddsMin, setOddsMin] = useState("");
  const [oddsMax, setOddsMax] = useState("");

  useEffect(() => {
    setPerf(null);
    fetchMarketPerformance(groupKey, {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      oddsMin: oddsMin || undefined,
      oddsMax: oddsMax || undefined,
    }).then(setPerf);
  }, [groupKey, dateFrom, dateTo, oddsMin, oddsMax]);

  // perf.market is the human-readable label ("Over 0.5 Corners FT") the backend
  // derives from normalizeMarket — groupKey itself is an internal grouping id
  // (e.g. "over|corners|0.5|ft") never meant for display, so show a loading
  // placeholder instead of the raw key while the fetch is still in flight.
  const marketLabel = perf?.market ?? null;

  const statRows = perf
    ? [
        { label: "Lucro", value: `${perf.lucroPct >= 0 ? "+" : ""}${perf.lucroPct}%`, className: perf.lucroPct >= 0 ? "text-accent" : "text-live" },
        { label: "Melhor good run", value: `${perf.bestRun.length} · +${perf.bestRun.profitPct}%`, className: "text-text" },
        { label: "Pior bad run", value: `${perf.worstRun.length} · ${perf.worstRun.profitPct}%`, className: "text-live" },
        { label: "Lucro / operação", value: `${perf.profitPerOpPct >= 0 ? "+" : ""}${perf.profitPerOpPct}%`, className: perf.profitPerOpPct >= 0 ? "text-accent" : "text-live" },
        { label: "Contagem", value: perf.totalOps.toLocaleString("pt-BR"), className: "text-text" },
        { label: "Contagem / dia", value: perf.opsPerDay.toString(), className: "text-text" },
        { label: "Assertividade", value: `${perf.assertPct}%`, className: "text-text" },
        { label: "Odd média", value: perf.avgOdds ? perf.avgOdds.toFixed(2) : "—", className: "text-text" },
        { label: "ROI", value: `${perf.roiPct}%`, className: perf.roiPct >= 0 ? "text-accent" : "text-live" },
        { label: "Drawdown máx.", value: `${perf.maxDrawdownPct}%`, className: "text-live" },
      ]
    : [];

  function clearDateFilter() {
    setDateFrom("");
    setDateTo("");
  }

  function clearOddsFilter() {
    setOddsMin("");
    setOddsMax("");
  }

  return (
    <div className="min-h-dvh bg-bg text-text lg:flex lg:min-h-full lg:flex-col">
      {/* ---------- Mobile ---------- */}
      <div className="lg:hidden">
        <div className="flex items-center gap-3 px-5 pb-1 pt-14">
          <button onClick={() => navigate(-1)} aria-label="Voltar">
            <IconChevronLeft size={20} />
          </button>
          <Logo size={22} rounded={7} />
          <span className="font-brand text-[16px] font-black tracking-[-0.03em]">Evobo</span>
        </div>

        <div className="px-4 pt-2.5 pb-1">
          <RobotTabs active="historico" />
        </div>

        <div className="px-4 pt-2.5">
          <div className="truncate text-[19px] font-bold tracking-[-0.02em]">
            {marketLabel ?? <span className="text-text-tertiary">Carregando…</span>}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-text-tertiary">Desempenho da carteira</div>
          {perf && perf.botNames.length > 0 && (
            <div className="mt-1.5 text-[11px] text-text-tertiary">
              {perf.botNames.length === 1
                ? perf.botNames[0]
                : `${perf.botNames.length} robôs juntados neste mercado`}
            </div>
          )}
        </div>

        <div className="flex gap-2.5 p-4">
          <div className="flex-1 rounded-2xl border border-border bg-surface-chip p-3">
            <div className="mb-1 font-mono text-[10px] text-text-tertiary">LUCRO</div>
            <div className={`font-mono text-[17px] font-bold ${(perf?.lucroPct ?? 0) >= 0 ? "text-accent" : "text-live"}`}>
              {perf ? `${perf.lucroPct >= 0 ? "+" : ""}${perf.lucroPct}%` : "—"}
            </div>
          </div>
          <div className="flex-1 rounded-2xl border border-border bg-surface-chip p-3">
            <div className="mb-1 font-mono text-[10px] text-text-tertiary">ASSERT.</div>
            <div className="font-mono text-[17px] font-bold">{perf ? `${perf.assertPct}%` : "—"}</div>
          </div>
          <div className="flex-1 rounded-2xl border border-border bg-surface-chip p-3">
            <div className="mb-1 font-mono text-[10px] text-text-tertiary">ROI</div>
            <div className={`font-mono text-[17px] font-bold ${(perf?.roiPct ?? 0) >= 0 ? "text-accent" : "text-live"}`}>
              {perf ? `${perf.roiPct}%` : "—"}
            </div>
          </div>
        </div>

        <div className="mx-4 mb-4 rounded-2xl border border-border bg-surface-chip p-3.5">
          <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold">
            <span className="h-2 w-4 rounded bg-accent" />
            Carteira
            <span className="ml-auto font-mono text-[11px] text-text-tertiary">
              {perf ? `${perf.totalOps.toLocaleString("pt-BR")} ops · odd ${perf.avgOdds?.toFixed(2) ?? "—"}` : "…"}
            </span>
          </div>
          <WalletChart operations={perf?.operations ?? []} height={130} />
        </div>

        <div className="mx-4 mb-4 rounded-2xl border border-border bg-surface-chip p-3.5">
          <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">FILTRO DE DATA</div>
          <div className="flex gap-2.5">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="flex-1 rounded-lg border border-border-strong bg-surface-alt px-2.5 py-2 font-mono text-[11px] text-text outline-none"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="flex-1 rounded-lg border border-border-strong bg-surface-alt px-2.5 py-2 font-mono text-[11px] text-text outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-4 pb-2">
          <span className="text-[14px] font-bold">Operações</span>
        </div>
        <div className="flex flex-col gap-2.5 px-4 pb-8">
          {perf === null && <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>}
          {perf?.operations.length === 0 && (
            <p className="py-10 text-center text-sm text-text-tertiary">Nenhuma operação encontrada.</p>
          )}
          {perf?.operations.map((op) => (
            <div key={op.id} className="rounded-2xl border border-border bg-surface-chip p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono text-[11px] text-text-tertiary">
                  {new Date(op.date).toLocaleDateString("pt-BR")}
                </span>
                <span className={`rounded-lg px-2 py-1 font-mono text-[10px] font-bold ${RESULT_STYLE[op.result].className}`}>
                  {RESULT_STYLE[op.result].label}
                </span>
              </div>
              <div className="mb-2 text-[13px] font-semibold">
                {op.homeTeam} <span className="text-text-quaternary">×</span> {op.awayTeam}
              </div>
              <div className="mb-2 font-mono text-[11px] text-text-tertiary">{op.competition}</div>
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="font-mono text-[11px] text-text-secondary">
                  {op.odds ? formatOdds(op.odds) : "—"}
                </span>
                <span className="font-mono text-[11px] text-text-tertiary">{op.stakeUnits}u</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---------- Desktop ---------- */}
      <div className="hidden lg:flex lg:flex-1 lg:flex-col">
        <div className="sticky top-0 z-10 flex-none border-b border-border bg-bg">
          <div className="flex h-[70px] items-center gap-3 px-8">
            <div className="flex items-center gap-2.5">
              <IconRobotMonitor size={24} className="text-accent" />
              <span className="text-[22px] font-bold tracking-[-0.02em]">Robô</span>
            </div>
            <RobotTabs active="historico" />
          </div>
          <div className="flex items-center gap-3 border-t border-border-subtle px-8 py-3.5">
            <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-gradient-to-br from-[#46F0A6] to-[#12B877]">
              <IconRobotMonitor size={18} className="text-[#06231A]" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[20px] font-bold tracking-[-0.02em]">
                {marketLabel ?? <span className="text-text-tertiary">Carregando…</span>}
              </div>
              <div className="font-mono text-[11px] text-text-tertiary">
                Desempenho da carteira
                {perf && perf.botNames.length > 1 && ` · ${perf.botNames.length} robôs juntados`}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 px-8 py-6">
          <div className="mb-5 flex gap-6">
            <div className="min-w-0 flex-1 rounded-2xl border border-border bg-surface-chip p-5">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="h-2.5 w-[22px] rounded bg-accent" />
                <span className="text-[13px] font-semibold text-text-muted">Carteira</span>
                <span className={`ml-auto font-mono text-[20px] font-bold ${(perf?.lucroPct ?? 0) >= 0 ? "text-accent" : "text-live"}`}>
                  {perf ? `${perf.lucroPct >= 0 ? "+" : ""}${perf.lucroPct}%` : "—"}
                </span>
              </div>
              <WalletChart operations={perf?.operations ?? []} height={270} />
            </div>

            <div className="w-[340px] flex-none rounded-2xl border border-border bg-surface-chip px-5">
              {statRows.map((row) => (
                <StatRow key={row.label} label={row.label} value={row.value} className={row.className} />
              ))}
            </div>
          </div>

          <div className="mb-5 flex gap-6">
            <div className="flex-1 rounded-2xl border border-border bg-surface-chip p-4">
              <div className="mb-3 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">FILTRO DE DATA</div>
              <div className="flex items-end gap-3.5">
                <label className="flex-1">
                  <span className="mb-1.5 block text-[12px] text-text-secondary">De</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full rounded-[11px] border border-border-strong bg-surface-alt px-3 py-2.5 font-mono text-[13px] text-text outline-none"
                  />
                </label>
                <label className="flex-1">
                  <span className="mb-1.5 block text-[12px] text-text-secondary">Até</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full rounded-[11px] border border-border-strong bg-surface-alt px-3 py-2.5 font-mono text-[13px] text-text outline-none"
                  />
                </label>
                <button
                  onClick={clearDateFilter}
                  className="flex h-[43px] items-center gap-1.5 rounded-[11px] border border-border-strong bg-surface-alt px-4 text-[13px] text-text-secondary"
                >
                  <IconX size={13} />
                  Limpar
                </button>
              </div>
            </div>

            <div className="flex-1 rounded-2xl border border-border bg-surface-chip p-4">
              <div className="mb-3 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">FILTRO DE ODD</div>
              <div className="flex items-end gap-3.5">
                <label className="flex-1">
                  <span className="mb-1.5 block text-[12px] text-text-secondary">De</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Ex: 1.50"
                    value={oddsMin}
                    onChange={(e) => setOddsMin(e.target.value)}
                    className="w-full rounded-[11px] border border-border-strong bg-surface-alt px-3 py-2.5 font-mono text-[13px] text-text outline-none"
                  />
                </label>
                <label className="flex-1">
                  <span className="mb-1.5 block text-[12px] text-text-secondary">Até</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Ex: 2.50"
                    value={oddsMax}
                    onChange={(e) => setOddsMax(e.target.value)}
                    className="w-full rounded-[11px] border border-border-strong bg-surface-alt px-3 py-2.5 font-mono text-[13px] text-text outline-none"
                  />
                </label>
                <button
                  onClick={clearOddsFilter}
                  className="flex h-[43px] items-center gap-1.5 rounded-[11px] border border-border-strong bg-surface-alt px-4 text-[13px] text-text-secondary"
                >
                  <IconX size={13} />
                  Limpar
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-surface-chip">
            <div className="flex items-center justify-between border-b border-border px-5.5 py-4">
              <span className="text-[14px] font-bold">Operações</span>
              <span className="font-mono text-[12px] text-text-tertiary">
                {perf ? `${perf.totalOps.toLocaleString("pt-BR")} entradas` : "…"}
              </span>
            </div>
            <div className="grid grid-cols-[96px_1.3fr_1.3fr_2fr_68px_92px] border-b border-border px-5.5 py-3 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">
              <span>DATA</span>
              <span>TIME 1</span>
              <span>TIME 2</span>
              <span>CAMPEONATO</span>
              <span className="text-center">UN.</span>
              <span className="text-center">RESULT.</span>
            </div>
            {perf === null && <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>}
            {perf?.operations.length === 0 && (
              <p className="py-10 text-center text-sm text-text-tertiary">Nenhuma operação encontrada.</p>
            )}
            {perf?.operations.map((op) => (
              <div
                key={op.id}
                className="grid grid-cols-[96px_1.3fr_1.3fr_2fr_68px_92px] items-center border-b border-border-subtle px-5.5 py-3.5 text-[13px] last:border-0"
              >
                <span className="font-mono text-[12px] text-text-secondary">
                  {new Date(op.date).toLocaleDateString("pt-BR")}
                </span>
                <span className="font-semibold">{op.homeTeam}</span>
                <span className="font-semibold">{op.awayTeam}</span>
                <span className="text-[12px] text-text-secondary">{op.competition}</span>
                <span className="text-center font-mono font-bold">{op.stakeUnits}u</span>
                <span className="text-center">
                  <span className={`inline-flex items-center rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold ${RESULT_STYLE[op.result].className}`}>
                    {RESULT_STYLE[op.result].label}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
