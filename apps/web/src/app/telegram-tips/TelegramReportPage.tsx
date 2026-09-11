import { useEffect, useState } from "react";
import { fetchTelegramBanca, type TelegramBancaSummary } from "../../lib/telegramTips";
import { IconTelegram } from "../../components/Icon";

export type TelegramBancaRowT = TelegramBancaSummary["geral"]["byGroup"][number];

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

function ScopeSection({ scope }: { scope: TelegramBancaSummary["geral"] }) {
  return (
    <>
      <div className="mb-2.5 mt-5 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">POR GRUPO</div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {scope.byGroup.map((r) => (
          <RowCard key={r.key} row={r} />
        ))}
        {scope.byGroup.length === 0 && <p className="text-sm text-text-tertiary">Nenhuma tip resolvida ainda.</p>}
      </div>

      <div className="mb-2.5 mt-6 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">POR CASA DE APOSTA</div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {scope.byBookmaker.map((r) => (
          <RowCard key={r.key} row={r} />
        ))}
        {scope.byBookmaker.length === 0 && <p className="text-sm text-text-tertiary">Nenhuma tip resolvida ainda.</p>}
      </div>
    </>
  );
}

export function TelegramReportPage() {
  const [summary, setSummary] = useState<TelegramBancaSummary | null>(null);
  const [tab, setTab] = useState<"geral" | "peguei">("geral");

  useEffect(() => {
    fetchTelegramBanca().then(setSummary).catch(() => {});
  }, []);

  return (
    <div className="pb-6 lg:mx-auto lg:max-w-[900px] lg:px-0 lg:pt-6">
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-3 lg:px-0">
        <IconTelegram size={22} className="text-accent" />
        <span className="text-[20px] font-bold tracking-[-0.02em] lg:text-[22px]">Relatório · VIP Telegram</span>
      </div>

      <div className="mx-5 flex gap-1.5 rounded-[12px] bg-surface-alt p-1 lg:mx-0 lg:w-fit">
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

      <div className="px-5 lg:px-0">
        {summary === null && <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>}
        {summary && <ScopeSection scope={summary[tab]} />}
      </div>
    </div>
  );
}
