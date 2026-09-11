import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { fetchTelegramBanca, fetchBookmakerNames, type TelegramBancaSummary } from "../../lib/telegramTips";
import { IconTelegram, IconChevronLeft } from "../../components/Icon";
import { Dropdown } from "../../components/Dropdown";
import { bookmakerLabel } from "../../lib/bookmakers";

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

/** Side-by-side compact table for POR GRUPO / POR CASA DE APOSTA — mirrors the
 * design brief's GRUPO|G/R|ACERTO|ROI|LUCRO columns instead of a stacked list. */
function BreakdownTable({
  title,
  subtitle,
  columnLabel,
  rows,
  label,
}: {
  title: string;
  subtitle: string;
  columnLabel: string;
  rows: TelegramBancaRowT[];
  label?: (key: string) => string;
}) {
  const sorted = [...rows].sort((a, b) => b.profit - a.profit);
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold">{title}</span>
        <span className="font-mono text-[10px] text-text-tertiary">{subtitle}</span>
      </div>
      {sorted.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-text-tertiary">Nenhuma tip resolvida ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[300px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-border-subtle text-left font-mono text-[9px] tracking-[0.04em] text-text-tertiary">
                <th className="pb-2 pr-2 font-normal">{columnLabel}</th>
                <th className="pb-2 pr-2 text-right font-normal">G/R</th>
                <th className="pb-2 pr-2 text-right font-normal">ACERTO</th>
                <th className="pb-2 pr-2 text-right font-normal">ROI</th>
                <th className="pb-2 text-right font-normal">LUCRO</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const positive = row.profit >= 0;
                return (
                  <tr key={row.key} className="border-b border-border-subtle last:border-0">
                    <td className="max-w-[130px] py-2.5 pr-2">
                      <div className="truncate font-semibold">{label ? label(row.key) : row.key}</div>
                      {row.greenPct != null && (
                        <div className="mt-1 h-1 w-full max-w-[90px] overflow-hidden rounded-full bg-surface-alt">
                          <div
                            className="h-full rounded-full bg-accent"
                            style={{ width: `${Math.min(100, Math.max(0, row.greenPct))}%` }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-2 text-right font-mono">
                      <span className="text-accent">{row.green}</span> / <span className="text-live">{row.red}</span>
                    </td>
                    <td className="py-2.5 pr-2 text-right font-mono text-text-secondary">
                      {row.greenPct != null ? `${row.greenPct}%` : "—"}
                    </td>
                    <td className="py-2.5 pr-2 text-right font-mono text-text-secondary">
                      {row.roiPct != null ? `${row.roiPct}%` : "—"}
                    </td>
                    <td className={`py-2.5 text-right font-mono font-bold ${positive ? "text-accent" : "text-live"}`}>
                      {positive ? "+" : ""}
                      {row.profit.toFixed(2)}u
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** `totals[tab]` summed across every group/bookmaker, as 4 scannable stat tiles (mirrors
 * the top stat row convention on MyProfilePage.tsx: rounded-2xl/border-border/bg-surface/p-4.5
 * tiles with a font-mono uppercase label + big number) instead of one hero card, so the
 * user sees "am I up or down overall" plus ROI/ACERTO/volume in one glance. */
function StatTiles({ row }: { row: TelegramBancaRowT }) {
  const positive = row.profit >= 0;
  const roiPositive = row.roiPct != null && row.roiPct >= 0;
  const acertoPct = row.greenPct ?? 0;
  return (
    <>
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-2xl border border-border bg-surface p-4.5">
          <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">LUCRO NO PERÍODO</div>
          <div className={`font-mono text-[20px] font-bold leading-tight ${positive ? "text-accent" : "text-live"}`}>
            {positive ? "+" : ""}
            {row.profit.toFixed(2)}u
          </div>
          {row.profitBRL !== null && (
            <div className="mt-0.5 font-mono text-[11px] text-text-tertiary">
              {positive ? "+" : ""}
              {row.profitBRL.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4.5">
          <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">ROI</div>
          <div
            className={`font-mono text-[20px] font-bold leading-tight ${
              row.roiPct == null ? "" : roiPositive ? "text-accent" : "text-live"
            }`}
          >
            {row.roiPct != null ? `${roiPositive ? "+" : ""}${row.roiPct}%` : "—"}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-text-tertiary">{row.staked.toFixed(2)}u apostados</div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4.5">
          <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">ACERTO</div>
          <div className="font-mono text-[20px] font-bold leading-tight">
            {row.greenPct != null ? `${row.greenPct}%` : "—"}
          </div>
          <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-surface-alt">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, acertoPct))}%` }} />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4.5">
          <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">TIPS</div>
          <div className="font-mono text-[20px] font-bold leading-tight">{row.total}</div>
          <div className="mt-0.5 font-mono text-[11px] text-text-tertiary">
            {row.green} green · {row.red} red
          </div>
        </div>
      </div>
      {row.missingOdd > 0 && (
        <div className="mt-3 text-[11px] text-vip">{row.missingOdd} tip(s) sem odd — resultado não entra no lucro.</div>
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
  // Nothing graded yet for this tab/período/casa — one clear message instead
  // of the stat tiles, chart and both breakdowns each repeating their own
  // "sem dados" placeholder.
  if (!totalRow) {
    return (
      <div className="mt-4 rounded-2xl border border-border bg-surface px-5 py-14 text-center">
        <p className="text-[14px] font-semibold">Nenhuma tip resolvida ainda</p>
        <p className="mx-auto mt-1.5 max-w-xs text-[12px] text-text-tertiary">
          Marque o resultado das tips (Green, Red ou Reemb.) no VIP Telegram para o relatório aparecer aqui.
        </p>
      </div>
    );
  }

  return (
    <>
      <StatTiles row={totalRow} />

      <div className="mt-4 rounded-2xl border border-border bg-surface p-[22px]">
        <div className="mb-5 text-[14px] font-bold">Evolução da banca</div>
        <BankrollChart points={points} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <BreakdownTable title="Por grupo" subtitle="ordenado por lucro" columnLabel="GRUPO" rows={scope.byGroup} />
        <BreakdownTable
          title="Por casa de aposta"
          subtitle={`${scope.byBookmaker.length} ${scope.byBookmaker.length === 1 ? "casa" : "casas"} · ordenado por lucro`}
          columnLabel="CASA"
          rows={scope.byBookmaker}
          label={bookmakerLabel}
        />
      </div>
    </>
  );
}

const DATE_RANGES: { label: string; days: number | undefined }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "tudo", days: undefined },
];

/** Wraps a CSV field in quotes (doubling any internal quotes) whenever it contains a
 * character that would otherwise break column boundaries or line breaks. */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(row: TelegramBancaRowT): string {
  return [
    csvField(row.key),
    csvField(row.green),
    csvField(row.red),
    csvField(row.greenPct != null ? row.greenPct : ""),
    csvField(row.roiPct != null ? row.roiPct : ""),
    csvField(row.profit.toFixed(2)),
    csvField(row.profitBRL !== null ? row.profitBRL.toFixed(2) : ""),
  ].join(",");
}

/** Builds a two-section CSV (POR GRUPO / POR CASA DE APOSTA) for the currently-visible
 * breakdown, sorted by profit descending — same order the on-screen list uses. */
function buildBreakdownCsv(scope: TelegramBancaSummary["geral"]): string {
  const header = ["grupo-ou-casa", "green", "red", "acerto%", "roi%", "lucro (u)", "lucro (R$)"].join(",");
  const byGroup = [...scope.byGroup].sort((a, b) => b.profit - a.profit);
  const byBookmaker = [...scope.byBookmaker].sort((a, b) => b.profit - a.profit);
  return [
    "POR GRUPO",
    header,
    ...byGroup.map(csvRow),
    "",
    "POR CASA DE APOSTA",
    header,
    ...byBookmaker.map(csvRow),
  ].join("\n");
}

function downloadCsv(filename: string, content: string) {
  // BOM so accented pt-BR characters open correctly in Excel; the rest is plain CSV.
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function TelegramReportPage() {
  const [summary, setSummary] = useState<TelegramBancaSummary | null>(null);
  const [tab, setTab] = useState<"geral" | "peguei">("geral");
  const [bookmaker, setBookmaker] = useState("");
  const [bookmakers, setBookmakers] = useState<string[]>([]);
  const [days, setDays] = useState<number | undefined>(30);

  useEffect(() => {
    fetchBookmakerNames().then(setBookmakers).catch(() => {});
  }, []);

  useEffect(() => {
    setSummary(null);
    fetchTelegramBanca(bookmaker || undefined, days)
      .then(setSummary)
      .catch(() => {});
  }, [bookmaker, days]);

  function handleExport() {
    if (!summary) return;
    const csv = buildBreakdownCsv(summary[tab]);
    const rangeLabel = days ? `${days}d` : "tudo";
    const bookmakerSlug = bookmaker || "todas-casas";
    downloadCsv(`telegram-banca-${tab}-${bookmakerSlug}-${rangeLabel}.csv`, csv);
  }

  return (
    <div className="pb-6 lg:max-w-[960px] lg:pl-6 lg:pr-6 lg:pt-6">
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-3 lg:px-0">
        <Link
          to="/telegram-tips"
          aria-label="Voltar"
          className="hidden flex-none items-center justify-center text-text-secondary lg:flex"
        >
          <IconChevronLeft size={20} />
        </Link>
        <IconTelegram size={22} className="text-accent" />
        <span className="text-[20px] font-bold tracking-[-0.02em] lg:text-[22px]">Relatório · VIP Telegram</span>
      </div>

      <div className="mx-5 flex flex-wrap items-center gap-3 lg:mx-0">
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

        <div className="flex gap-1.5 rounded-[12px] bg-surface-alt p-1">
          {DATE_RANGES.map((range) => (
            <button
              key={range.label}
              onClick={() => setDays(range.days)}
              className={`rounded-[9px] px-3.5 py-1.5 text-center text-[13px] font-semibold ${
                days === range.days ? "bg-accent text-[#08090A]" : "text-text-secondary"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>

        <Dropdown
          value={bookmaker}
          onChange={setBookmaker}
          placeholder="Todas as casas"
          options={bookmakers.map((b) => ({ value: b, label: bookmakerLabel(b) }))}
          className="w-auto flex-none"
        />

        <button
          onClick={handleExport}
          disabled={!summary}
          className="ml-auto flex-none rounded-[11px] border border-border-strong px-3.5 py-1.5 text-[13px] font-semibold text-text disabled:opacity-40 lg:ml-0"
        >
          ⤓ Exportar
        </button>
      </div>

      <div className="px-5 lg:px-0">
        {summary === null && <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>}
        {summary && <ScopeSection scope={summary[tab]} points={summary.series[tab]} totalRow={summary.totals[tab]} />}
      </div>
    </div>
  );
}
