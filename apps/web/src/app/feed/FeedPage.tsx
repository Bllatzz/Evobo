import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchFeed, fetchGames, type FeedTip } from "../../lib/tips";
import type { Game } from "@evobo/shared-types";
import { TipCard } from "../../components/TipCard";
import { DesktopFeedRail } from "../../components/DesktopFeedRail";
import { IconSearch } from "../../components/Icon";

const tabs = [
  { key: "para-voce", label: "Para você" },
  { key: "seguindo", label: "Seguindo" },
  { key: "vip", label: "VIP" },
  { key: "verificados", label: "Verificados" },
] as const;

const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Story ring color encodes real status: live (red/gold), starting today (green), further out (gray) — matches the design's D1 stories row. */
function storyRing(game: Game): string {
  if (game.status === "live") return "bg-gradient-to-br from-live to-vip";
  const daysUntil = Math.floor((new Date(game.startsAt).getTime() - Date.now()) / 86_400_000);
  return daysUntil <= 0 ? "bg-accent" : "bg-[#2A2E33]";
}

function storyCaption(game: Game): string {
  if (game.status === "live") return "ao vivo";
  const start = new Date(game.startsAt);
  const daysUntil = Math.floor((start.getTime() - Date.now()) / 86_400_000);
  if (daysUntil <= 0) return start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (daysUntil === 1) return "Amanhã";
  return weekdays[start.getDay()]!;
}

export function FeedPage() {
  const [tips, setTips] = useState<FeedTip[] | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [activeTab, setActiveTab] = useState<string>("para-voce");

  const loadFeed = useCallback(() => {
    fetchFeed().then(setTips);
  }, []);

  useEffect(() => {
    loadFeed();
    fetchGames().then(setGames);
  }, [loadFeed]);

  // "Seguindo" has no real filter yet — FeedTip carries no per-tip
  // "authored by someone I follow" flag from the backend to filter on, so
  // it currently falls through to the same list as "Para você" (known gap,
  // needs a backend field before this can be fixed correctly).
  const visibleTips =
    activeTab === "verificados"
      ? (tips ?? []).filter((t) => t.author.verifiedAt)
      : activeTab === "vip"
        ? (tips ?? []).filter((t) => t.visibility === "vip_only")
        : (tips ?? []);

  return (
    <div className="pb-6 lg:flex lg:items-start lg:gap-8 lg:px-7 lg:pb-10 lg:pt-6">
    <div className="lg:min-w-0 lg:flex-1">
      {/* game shortcuts */}
      {games.length > 0 && (
        <div className="flex gap-3.5 overflow-x-auto px-4 pb-3 pt-2">
          {games.slice(0, 8).map((game) => (
            <div key={game.id} className="flex flex-none flex-col items-center gap-1.5">
              <div className={`flex h-[60px] w-[60px] items-center justify-center rounded-full p-0.5 ${storyRing(game)}`}>
                <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-surface-alt font-mono text-[10px] leading-tight">
                  <span className="font-semibold text-text">{game.homeTeam.slice(0, 3).toUpperCase()}</span>
                  <span className="text-text-quaternary">x</span>
                  <span className="font-semibold text-text">{game.awayTeam.slice(0, 3).toUpperCase()}</span>
                </div>
              </div>
              <span className={`font-mono text-[10px] ${game.status === "live" ? "text-live" : "text-text-tertiary"}`}>
                {storyCaption(game)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* tabs */}
      <div className="flex items-center gap-5 border-b border-border px-5 text-[14px] font-medium">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1 pb-2.5 ${
              activeTab === tab.key ? "border-b-2 border-accent text-text" : "text-text-tertiary"
            }`}
          >
            {tab.label}
            {tab.key === "vip" && <span className="h-1.5 w-1.5 rounded-full bg-vip" />}
          </button>
        ))}
        <Link
          to="/search"
          className="ml-auto mb-2.5 hidden w-[240px] items-center gap-2.5 rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 text-[13px] text-text-tertiary lg:flex"
        >
          <IconSearch size={17} />
          Buscar tipster, jogo…
        </Link>
      </div>

      {/* feed */}
      <div className="flex flex-col gap-3.5 px-4 pt-3.5">
        {tips === null && (
          <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>
        )}
        {tips && visibleTips.length === 0 && (
          <p className="py-10 text-center text-sm text-text-tertiary">
            {activeTab === "verificados"
              ? "Nenhuma tip de tipster verificado ainda."
              : "Nenhuma tip por aqui ainda."}
          </p>
        )}
        {visibleTips.map((tip) => <TipCard key={tip.id} tip={tip} onChange={loadFeed} />)}
      </div>
    </div>

      <div className="hidden lg:sticky lg:top-6 lg:block">
        <DesktopFeedRail />
      </div>
    </div>
  );
}
