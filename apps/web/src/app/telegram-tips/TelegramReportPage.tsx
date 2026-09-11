import { useEffect, useState, type MouseEvent } from "react";
import { fetchTelegramBanca, fetchBookmakerNames, type TelegramBancaSummary } from "../../lib/telegramTips";
import { IconTelegram } from "../../components/Icon";
import { Dropdown } from "../../components/Dropdown";

export type TelegramBancaRowT = TelegramBancaSummary["geral"]["byGroup"][number];
type SeriesPoint = TelegramBancaSummary["series"]["geral"][number];

/** Cumulative profit curve for the active tab, same crosshair-tooltip interaction as
 * the Robô page's WalletChart (apps/web/src/app/robot/MarketChartPage.tsx) — reused
 * verbatim here so hovering the line surfaces the actual date/value instead of a bare shape. */
function BankrollChart({ points }: { points: SeriesPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const height = 140;

  if (points.length < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-[12px] text-text-tertiary">
        Poucas tips resolvidas para desenhar o gráfico.
      </div>
    );
  }

  const values = points.map((p) => p.profit);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const width = 600;
  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPoints = `0,${height} ${coords.join(" ")} ${width},${height}`;
  const positive = values[values.length - 1]! >= 0;

  function handleMove(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    const index = Math.round(fraction * (values.length - 1));
    setHoverIndex(Math.min(values.length - 1, Math.max(0, index)));
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? (hoverIndex / (values.length - 1)) * width : 0;
  const hoverY = hoverIndex !== null ? height - ((values[hoverIndex]! - min) / span) * height : 0;
  // Flip the tooltip to the left half once the point crosses the chart's midline, so it never clips outside the svg.
  const tooltipLeftPct = (hoverX / width) * 100;
  const tooltipAlign = tooltipLeftPct > 60 ? "right" : tooltipLeftPct < 40 ? "left" : "center";
  const hoveredDate = hovered ? new Date(hovered.t) : null;
  const hoveredDateLabel =
    hoveredDate && !Number.isNaN(hoveredDate.getTime()) ? hoveredDate.toLocaleDateString("pt-BR") : hovered?.t ?? "";

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
          <linearGradient id="telegramBankrollFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.4" className={positive ? "text-accent" : "text-live"} />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" className={positive ? "text-accent" : "text-live"} />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill="url(#telegramBankrollFill)" />
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          className={positive ? "text-accent" : "text-live"}
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
              className={positive ? "text-accent" : "text-live"}
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
          <div className="text-text-tertiary">{hoveredDateLabel}</div>
          <div className={`font-bold ${hovered.profit >= 0 ? "text-accent" : "text-live"}`}>
            {hovered.profit >= 0 ? "+" : ""}
            {hovered.profit.toFixed(2)}u
          </div>
        </div>
      )}
    </div>
  );
}

/** Kept exported with its original name/signature for external compatibility — the
 * visible breakdown below now uses the more compact BreakdownRow list instead, see
 * the file-level note in the redesign. */
export function RowCard({ row }: { row: TelegramBancaRowT }) {
  const positive = row.profit >= 0;
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="truncate text-[14px] font-bold capitalize">{row.key}</span>
        <span className={`font-mono text-[16px] font-bold ${positive ? "text-accent" : "text-live"}`}>
          {positive ? "+" : ""}
          {row.profit.toFixed(2)}u
          {row.profitBRL !== null && (
            <span className="ml-1.5 text-[12px] text-text-tertiary">
              ({positive ? "+" : ""}
              {row.profitBRL.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})
            </span>
          )}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        <div>
          <div className="font-mono text-[13px] font-bold text-accent">{row.green}</div>
          <div className="text-[10px] text-text-tertiary">GREEN</div>
        </div>
        <div>
          <div className="font-mono text-[13px] font-bold text-live">{row.red}</div>
          <div className="text-[10px] text-text-tertiary">RED</div>
        </div>
        <div>
          <div className="font-mono text-[13px] font-bold">{row.greenPct != null ? `${row.greenPct}%` : "—"}</div>
          <div className="text-[10px] text-text-tertiary">ACERTO</div>
        </div>
        <div>
          <div className="font-mono text-[13px] font-bold">{row.roiPct != null ? `${row.roiPct}%` : "—"}</div>
          <div className="text-[10px] text-text-tertiary">ROI</div>
        </div>
      </div>
      {row.missingOdd > 0 && (
        <div className="mt-2.5 text-[11px] text-vip">{row.missingOdd} tip(s) sem odd — resultado não entra no lucro.</div>
      )}
    </div>
  );
}

/** Compact, profit-first list row for the POR GRUPO / POR CASA DE APOSTA breakdowns.
 * Profit is the one number that matters at a glance; green/red/acerto/roi are folded
 * into a single muted secondary line instead of four equal-weight stat blocks, so a
 * list of 4-5+ entries scans instead of reading as a wall of near-identical cards. */
function BreakdownRow({ row }: { row: TelegramBancaRowT }) {
  const positive = row.profit >= 0;
  const stats = [
    `${row.green}G`,
    `${row.red}R`,
    row.greenPct != null ? `${row.greenPct}% acerto` : null,
    row.roiPct != null ? `ROI ${row.roiPct}%` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 last:border-0">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold capitalize">{row.key}</div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">{stats}</div>
        {row.missingOdd > 0 && (
          <div className="mt-0.5 text-[10px] text-vip">{row.missingOdd} sem odd — fora do lucro</div>
        )}
      </div>
      <div className="flex-none text-right">
        <div className={`font-mono text-[14px] font-bold ${positive ? "text-accent" : "text-live"}`}>
          {positive ? "+" : ""}
          {row.profit.toFixed(2)}u
        </div>
        {row.profitBRL !== null && (
          <div className="font-mono text-[10px] text-text-tertiary">
            {positive ? "+" : ""}
            {row.profitBRL.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </div>
        )}
      </div>
    </div>
  );
}

/** The bottom line: `totals[tab]` summed across every group/bookmaker, so the user sees
 * "am I up or down overall" in one glance instead of mentally summing N cards below. */
function TotalHero({ row }: { row: TelegramBancaRowT | null }) {
  if (!row) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5 text-center text-[13px] text-text-tertiary">
        Nenhuma tip resolvida ainda.
      </div>
    );
  }
  const positive = row.profit >= 0;
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-text-secondary">Saldo total</span>
        <span className="text-right">
          <span className={`font-mono text-[26px] font-bold leading-none ${positive ? "text-accent" : "text-live"}`}>
            {positive ? "+" : ""}
            {row.profit.toFixed(2)}u
          </span>
          {row.profitBRL !== null && (
            <span className="ml-2 font-mono text-[12px] text-text-tertiary">
              ({positive ? "+" : ""}
              {row.profitBRL.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})
            </span>
          )}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 border-t border-border-subtle pt-4 text-center">
        <div>
          <div className="font-mono text-[14px] font-bold text-accent">{row.green}</div>
          <div className="text-[10px] text-text-tertiary">GREEN</div>
        </div>
        <div>
          <div className="font-mono text-[14px] font-bold text-live">{row.red}</div>
          <div className="text-[10px] text-text-tertiary">RED</div>
        </div>
        <div>
          <div className="font-mono text-[14px] font-bold">{row.greenPct != null ? `${row.greenPct}%` : "—"}</div>
          <div className="text-[10px] text-text-tertiary">ACERTO</div>
        </div>
        <div>
          <div className="font-mono text-[14px] font-bold">{row.roiPct != null ? `${row.roiPct}%` : "—"}</div>
          <div className="text-[10px] text-text-tertiary">ROI</div>
        </div>
      </div>
      {row.missingOdd > 0 && (
        <div className="mt-3 text-[11px] text-vip">{row.missingOdd} tip(s) sem odd — resultado não entra no lucro.</div>
      )}
    </div>
  );
}

function BreakdownSection({ title, rows }: { title: string; rows: TelegramBancaRowT[] }) {
  const sorted = [...rows].sort((a, b) => b.profit - a.profit);
  return (
    <>
      <div className="mb-2.5 mt-6 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">{title}</div>
      {sorted.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface px-4 py-6 text-center text-[13px] text-text-tertiary">
          Nenhuma tip resolvida ainda.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {sorted.map((r) => (
            <BreakdownRow key={r.key} row={r} />
          ))}
        </div>
      )}
    </>
  );
}

function ScopeSection({
  scope,
  points,
  totalRow,
}: {
  scope: TelegramBancaSummary["geral"];
  points: SeriesPoint[];
  totalRow: TelegramBancaRowT | null;
}) {
  return (
    <>
      <TotalHero row={totalRow} />

      <div className="mt-4 rounded-2xl border border-border bg-surface p-[22px]">
        <div className="mb-5 text-[14px] font-bold">Evolução da banca</div>
        <BankrollChart points={points} />
      </div>

      <BreakdownSection title="POR GRUPO" rows={scope.byGroup} />
      <BreakdownSection title="POR CASA DE APOSTA" rows={scope.byBookmaker} />
    </>
  );
}

export function TelegramReportPage() {
  const [summary, setSummary] = useState<TelegramBancaSummary | null>(null);
  const [tab, setTab] = useState<"geral" | "peguei">("geral");
  const [bookmaker, setBookmaker] = useState("");
  const [bookmakers, setBookmakers] = useState<string[]>([]);

  useEffect(() => {
    fetchBookmakerNames().then(setBookmakers).catch(() => {});
  }, []);

  useEffect(() => {
    setSummary(null);
    fetchTelegramBanca(bookmaker || undefined)
      .then(setSummary)
      .catch(() => {});
  }, [bookmaker]);

  return (
    <div className="pb-6 lg:mx-auto lg:max-w-[900px] lg:px-0 lg:pt-6">
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-3 lg:px-0">
        <IconTelegram size={22} className="text-accent" />
        <span className="text-[20px] font-bold tracking-[-0.02em] lg:text-[22px]">Relatório · VIP Telegram</span>
      </div>

      <div className="mx-5 flex items-center gap-3 lg:mx-0">
        <div className="flex gap-1.5 rounded-[12px] bg-surface-alt p-1 lg:w-fit">
          {(["geral", "peguei"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 rounded-[9px] px-5 py-1.5 text-center text-[13px] font-semibold lg:flex-none ${
                tab === key ? "bg-accent text-[#08090A]" : "text-text-secondary"
              }`}
            >
              {key === "geral" ? "Geral" : "Peguei"}
            </button>
          ))}
        </div>
        <Dropdown
          value={bookmaker}
          onChange={setBookmaker}
          placeholder="Todas as casas"
          options={bookmakers.map((b) => ({ value: b, label: b }))}
          className="ml-auto w-auto flex-none lg:ml-0"
        />
      </div>

      <div className="px-5 lg:px-0">
        {summary === null && <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>}
        {summary && <ScopeSection scope={summary[tab]} points={summary.series[tab]} totalRow={summary.totals[tab]} />}
      </div>
    </div>
  );
}
