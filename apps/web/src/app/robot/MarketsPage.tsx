import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchRobotMarkets, type RobotMarketSummary } from "../../lib/robot";
import { IconRobotMonitor, IconTrophy, IconExternalLink } from "../../components/Icon";
import { RobotTabs } from "./RobotTabs";

function MarketRow({ market }: { market: RobotMarketSummary }) {
  return (
    <Link
      to={`/robot/market/${encodeURIComponent(market.groupKey)}`}
      className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-border-strong"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <IconTrophy size={14} className="flex-none text-vip" />
          <span className="truncate text-[14px] font-semibold">{market.market}</span>
        </div>
        <div className="mt-1 font-mono text-[11px] text-text-tertiary">
          {market.totalOps.toLocaleString("pt-BR")} ops · assert. {market.assertPct}%
        </div>
      </div>
      <div className="flex flex-none items-center gap-4">
        <div className="text-right">
          <div className="font-mono text-[10px] text-text-tertiary">LUCRO</div>
          <div className={`font-mono text-[16px] font-bold ${market.lucroPct >= 0 ? "text-accent" : "text-live"}`}>
            {market.lucroPct >= 0 ? "+" : ""}
            {market.lucroPct}%
          </div>
        </div>
        <IconExternalLink size={14} className="flex-none text-text-tertiary" />
      </div>
    </Link>
  );
}

export function MarketsPage() {
  const [markets, setMarkets] = useState<RobotMarketSummary[] | null>(null);

  useEffect(() => {
    fetchRobotMarkets().then(setMarkets);
  }, []);

  return (
    <>
      {/* Desktop */}
      <div className="hidden h-full lg:flex lg:flex-1 lg:flex-col">
        <div className="flex flex-none items-center gap-3 border-b border-border px-8 py-[18px]">
          <div className="flex items-center gap-2.5">
            <IconRobotMonitor size={24} className="text-accent" />
            <span className="text-[22px] font-bold tracking-[-0.02em]">Robô</span>
          </div>
          <RobotTabs active="historico" />
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3">
            {markets === null && (
              <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>
            )}
            {markets?.length === 0 && (
              <p className="py-10 text-center text-sm text-text-tertiary">Nenhum histórico encontrado.</p>
            )}
            {markets?.map((m) => <MarketRow key={m.groupKey} market={m} />)}
          </div>
        </div>
      </div>

      {/* Mobile */}
      <div className="pb-6 lg:hidden">
        <div className="flex items-center gap-2 px-5 pb-1 pt-3">
          <IconRobotMonitor size={20} className="text-accent" />
          <span className="text-[20px] font-bold tracking-[-0.02em]">Robô</span>
        </div>
        <div className="px-5 pb-1 text-[11px] text-text-tertiary">
          Todo o histórico, agrupado por mercado
        </div>
        <div className="px-5 pb-3">
          <RobotTabs active="historico" />
        </div>

        <div className="flex flex-col gap-2.5 px-4">
          {markets === null && (
            <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>
          )}
          {markets?.length === 0 && (
            <p className="py-10 text-center text-sm text-text-tertiary">Nenhum histórico encontrado.</p>
          )}
          {markets?.map((m) => <MarketRow key={m.groupKey} market={m} />)}
        </div>
      </div>
    </>
  );
}
