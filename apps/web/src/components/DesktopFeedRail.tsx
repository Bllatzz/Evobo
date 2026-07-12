import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Game } from "@evobo/shared-types";
import { fetchGames } from "../lib/tips";
import { fetchRanking, type RankedTipster } from "../lib/ranking";
import { Avatar } from "./Avatar";
import { IconTrendingUp } from "./Icon";

/**
 * Right rail on the desktop Feed layout ("Desktop · Feed" in the design).
 * Real data only — the design's mockup shows fabricated EV%/example scores,
 * but EV+ has no real data source wired up yet (see EvPage), so that
 * section stays an honest placeholder instead of inventing figures.
 */
export function DesktopFeedRail() {
  const [liveGames, setLiveGames] = useState<Game[] | null>(null);
  const [topTipsters, setTopTipsters] = useState<RankedTipster[] | null>(null);

  useEffect(() => {
    fetchGames({ status: "live" }).then((g) => setLiveGames(g.slice(0, 3)));
    fetchRanking("roi").then((r) => setTopTipsters(r.slice(0, 3)));
  }, []);

  return (
    <div className="flex w-[300px] flex-none flex-col gap-5">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-live" />
            <span className="text-[15px] font-bold">Ao Vivo</span>
          </div>
          <Link to="/ao-vivo" className="font-mono text-[11px] text-text-tertiary">
            ver todos
          </Link>
        </div>
        <div className="flex flex-col gap-2.5">
          {liveGames === null && (
            <p className="text-[12px] text-text-tertiary">Carregando…</p>
          )}
          {liveGames?.length === 0 && (
            <p className="text-[12px] text-text-tertiary">Nenhum jogo ao vivo agora.</p>
          )}
          {liveGames?.map((game) => (
            <div key={game.id} className="rounded-[14px] border border-border bg-surface p-3">
              <div className="mb-2 flex justify-between font-mono text-[10px] text-text-tertiary">
                <span>{game.league.toUpperCase()}</span>
                <span className="text-live">AO VIVO</span>
              </div>
              <div className="mb-1 flex justify-between">
                <span className="text-[13px] font-semibold">{game.homeTeam}</span>
                <span className="font-mono text-[14px] font-bold text-accent">
                  {game.scoreHome ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[13px] font-semibold">{game.awayTeam}</span>
                <span className="font-mono text-[14px] font-bold">{game.scoreAway ?? 0}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-1.5">
          <IconTrendingUp size={16} className="text-accent" />
          <span className="text-[15px] font-bold">
            EV<span className="text-accent">+</span>
          </span>
          <span className="font-mono text-[11px] text-text-tertiary">· valor da IA</span>
        </div>
        <div className="rounded-2xl border border-accent-border bg-accent-soft p-3.5 text-[12px] text-text-secondary">
          Em breve.
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[15px] font-bold">Top tipsters</span>
          <span className="font-mono text-[11px] text-text-tertiary">30d</span>
        </div>
        <div className="flex flex-col rounded-2xl border border-border bg-surface p-1.5">
          {topTipsters === null && (
            <p className="p-2.5 text-[12px] text-text-tertiary">Carregando…</p>
          )}
          {topTipsters?.length === 0 && (
            <p className="p-2.5 text-[12px] text-text-tertiary">Sem dados suficientes ainda.</p>
          )}
          {topTipsters?.map((t, i) => (
            <Link
              key={t.id}
              to={`/u/${t.username}`}
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2"
            >
              <span className="w-4 font-mono text-[13px] font-bold text-text-tertiary">
                {i + 1}
              </span>
              <Avatar name={t.displayName} seed={t.id} src={t.avatarUrl} size={32} />
              <span className="flex-1 truncate text-[13px] font-semibold">{t.displayName}</span>
              <span className="font-mono text-[13px] font-bold text-accent">
                {t.roi >= 0 ? "+" : ""}
                {t.roi.toFixed(0)}%
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
