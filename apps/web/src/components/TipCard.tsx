import { Link } from "react-router-dom";
import type { FeedTip } from "../lib/tips";
import { takeTip, untakeTip } from "../lib/tips";
import { formatConfidence, formatOdds, formatUnits, timeAgo } from "../lib/format";
import { avatarGradient } from "../lib/avatar";
import { Avatar } from "./Avatar";
import { VerifiedBadge } from "./VerifiedBadge";
import { IconArrowUp, IconCheck, IconComment, IconExternalLink, IconShare } from "./Icon";

function TeamCrest({ team }: { team: string }) {
  return (
    <div
      className="flex h-6 w-6 flex-none items-center justify-center rounded-md font-mono text-[9px] font-bold text-white"
      style={{ background: avatarGradient(team) }}
    >
      {team.slice(0, 3).toUpperCase()}
    </div>
  );
}

export function TipCard({ tip, onChange }: { tip: FeedTip; onChange?: () => void }) {
  const confidenceLabel = formatConfidence(tip.confidence);

  async function handleTake(e: React.MouseEvent) {
    e.preventDefault();
    if (tip.takenByMe) {
      await untakeTip(tip.id);
    } else {
      await takeTip(tip.id);
    }
    onChange?.();
  }

  return (
    <Link
      to={`/tip/${tip.id}`}
      className="block rounded-[22px] border border-border bg-surface p-3.5 lg:p-[18px]"
    >
      {/* author row */}
      <div className="mb-3.5 flex items-center gap-2.5">
        <Avatar name={tip.author.displayName} seed={tip.author.id} src={tip.author.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[15px] font-semibold lg:text-[16px]">
            {tip.author.displayName}
            {tip.author.verifiedAt && <VerifiedBadge />}
          </div>
          <div className="font-mono text-[11px] text-text-tertiary">
            @{tip.author.username} · {timeAgo(tip.createdAt)}
          </div>
        </div>
        {tip.visibility === "vip_only" && (
          <span className="font-mono text-[8px] font-bold text-vip" style={{ border: "1px solid rgba(246,196,83,.4)", borderRadius: 5, padding: "1px 5px" }}>
            VIP
          </span>
        )}
      </div>

      {/* match banner */}
      <div className="mb-3 rounded-[14px] bg-surface-alt px-3.5 py-3">
        <div className="mb-2.5 flex justify-between font-mono text-[10px] text-text-tertiary">
          <span>{tip.match.league.toUpperCase()}</span>
          <span>
            {new Date(tip.match.startsAt).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TeamCrest team={tip.match.homeTeam} />
            <span className="text-[14px] font-semibold">{tip.match.homeTeam}</span>
          </div>
          <span className="font-mono text-[11px] text-text-quaternary">VS</span>
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold">{tip.match.awayTeam}</span>
            <TeamCrest team={tip.match.awayTeam} />
          </div>
        </div>
      </div>

      {/* market / odd */}
      <div className="mb-3 flex items-stretch gap-3">
        <div className="flex-1">
          <div className="mb-0.5 font-mono text-[9px] tracking-[0.08em] text-text-tertiary">
            MERCADO
          </div>
          <div className="mb-2 text-[16px] font-semibold">{tip.market}</div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-surface-alt px-2 py-1 font-mono text-[11px] text-text-secondary">
              Stake {formatUnits(tip.stakeUnits)}
            </span>
            {confidenceLabel && (
              <span className="rounded-lg bg-accent-soft px-2 py-1 font-mono text-[11px] text-accent">
                {confidenceLabel}
              </span>
            )}
          </div>
        </div>
        <div className="flex w-[86px] flex-none flex-col items-center justify-center rounded-[14px] border border-accent-border bg-accent-soft lg:w-[148px] lg:gap-1">
          <span className="text-[9px] text-text-secondary">ODD</span>
          <span className="font-mono text-[26px] font-bold leading-none text-accent lg:text-[40px]">
            {formatOdds(tip.odds)}
          </span>
        </div>
      </div>

      {/* actions */}
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            window.open(tip.house, "_blank", "noopener,noreferrer");
          }}
          className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[13px] bg-accent text-[14px] font-semibold text-[#08090A]"
        >
          Abrir aposta <IconExternalLink size={14} />
        </button>
        <button
          type="button"
          onClick={handleTake}
          className={`flex h-11 w-[84px] flex-none items-center justify-center gap-1.5 rounded-[13px] border text-[13px] font-semibold lg:w-auto lg:px-4 ${
            tip.takenByMe
              ? "border-accent bg-accent-soft text-accent"
              : "border-border-strong text-text"
          }`}
        >
          {tip.takenByMe && <IconCheck size={13} />} Peguei
          <span className="hidden font-mono lg:inline">· {tip._count.takes}</span>
        </button>
        <Link
          to={`/tip/${tip.id}/analise-ia`}
          onClick={(e) => e.stopPropagation()}
          className="flex h-11 w-12 flex-none items-center justify-center gap-1.5 rounded-[13px] border border-verified/40 bg-verified-soft font-mono text-[13px] font-bold text-verified lg:w-auto lg:px-4"
        >
          <span className="lg:hidden">IA</span>
          <span className="hidden lg:inline">Análise IA</span>
        </Link>
      </div>

      {/* social */}
      <div className="flex items-center gap-4 border-t border-border pt-2.5 font-mono text-[13px] text-text-secondary">
        <span className="flex items-center gap-1.5 text-accent">
          <IconArrowUp size={15} /> {tip._count.takes}
        </span>
        <span className="flex items-center gap-1.5">
          <IconComment size={15} /> {tip._count.comments}
        </span>
        <span className="ml-auto">
          <IconShare size={15} />
        </span>
      </div>
    </Link>
  );
}
