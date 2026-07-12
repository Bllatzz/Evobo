import { Link } from "react-router-dom";
import type { RankedTipster } from "../lib/ranking";
import { Avatar } from "./Avatar";
import { VerifiedBadge } from "./VerifiedBadge";
import { IconCrown } from "./Icon";

/**
 * Right rail on the desktop Ranking layout ("Desktop · Ranking" in the
 * design) — the featured "Nº1 do mês" card and a community-stats panel,
 * built from the same `ranking` list the page already fetched (no fake
 * numbers like the mockup's "Tips hoje: 1.4k", which isn't real data we have).
 */
export function DesktopRankingRail({ ranking }: { ranking: RankedTipster[] }) {
  const leader = ranking[0];
  const verifiedCount = ranking.filter((t) => t.verifiedAt).length;
  const avgRoi = ranking.length > 0 ? ranking.reduce((sum, t) => sum + t.roi, 0) / ranking.length : 0;

  return (
    <div className="flex w-[300px] flex-none flex-col gap-4">
      {leader && (
        <div className="rounded-2xl border border-vip-border bg-gradient-to-br from-[#2A2410] to-surface p-5 text-center">
          <div className="mb-3.5 flex items-center justify-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-vip">
            <IconCrown size={12} />
            Nº 1 DO MÊS
          </div>
          <Avatar name={leader.displayName} seed={leader.id} src={leader.avatarUrl} size={76} />
          <div className="mt-3 mb-0.5 flex items-center justify-center gap-1.5">
            <span className="text-[17px] font-bold">{leader.displayName}</span>
            {leader.verifiedAt && <VerifiedBadge size={15} />}
          </div>
          <div className="mb-4 font-mono text-[11px] text-text-tertiary">
            @{leader.username} · {leader.followers} seguidores
          </div>
          <div className="mb-4 flex justify-around border-y border-border py-3.5">
            <div>
              <div className="font-mono text-[17px] font-bold text-accent">
                {leader.roi >= 0 ? "+" : ""}
                {leader.roi.toFixed(0)}%
              </div>
              <div className="text-[9px] text-text-tertiary">ROI 30D</div>
            </div>
            <div>
              <div className="font-mono text-[17px] font-bold">{leader.hitRate.toFixed(0)}%</div>
              <div className="text-[9px] text-text-tertiary">WINRATE</div>
            </div>
            <div>
              <div className="font-mono text-[17px] font-bold">{leader.tipsCount}</div>
              <div className="text-[9px] text-text-tertiary">TIPS</div>
            </div>
          </div>
          <Link
            to={`/u/${leader.username}`}
            className="flex h-[46px] items-center justify-center gap-1.5 rounded-[13px] bg-gradient-to-br from-vip to-[#d99e1a] text-[14px] font-bold text-[#08090A]"
          >
            Ver perfil
          </Link>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3.5 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
          MÉDIA DA COMUNIDADE
        </div>
        <div className="mb-3 flex justify-between">
          <span className="text-[13px] text-text-muted">ROI médio</span>
          <span className="font-mono text-[14px] font-bold text-accent">
            {avgRoi >= 0 ? "+" : ""}
            {avgRoi.toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[13px] text-text-muted">Tipsters verificados</span>
          <span className="font-mono text-[14px] font-bold">{verifiedCount}</span>
        </div>
      </div>
    </div>
  );
}
