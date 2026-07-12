import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchRanking, type RankedTipster } from "../../lib/ranking";
import { Avatar } from "../../components/Avatar";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { DesktopRankingRail } from "../../components/DesktopRankingRail";
import { IconCrown } from "../../components/Icon";

/** Desktop podium (D2) — a 2nd/1st/3rd bar-chart layout, quite different from
 * the mobile podium's flat row of avatars. Bar heights and border colors are
 * fixed per position (gold/silver/bronze), not data-driven. */
function DesktopPodium({ top3 }: { top3: RankedTipster[] }) {
  const [first, second, third] = [top3[0], top3[1], top3[2]];
  const slots = [
    { tipster: second, place: 2, barHeight: 84, avatarSize: 64, ring: "border-[#C0C5CC]", barBg: "from-[#1C1F22] to-surface-alt", numberColor: "text-text-secondary" },
    { tipster: first, place: 1, barHeight: 118, avatarSize: 78, ring: "border-vip shadow-[0_0_30px_rgba(246,196,83,.4)]", barBg: "from-[#2A2410] to-surface-alt", numberColor: "text-vip" },
    { tipster: third, place: 3, barHeight: 60, avatarSize: 64, ring: "border-[#C08A4A]", barBg: "from-[#1C1F22] to-surface-alt", numberColor: "text-[#C08A4A]" },
  ] as const;

  return (
    <div className="mb-6 flex items-end justify-center gap-4.5">
      {slots.map(({ tipster, place, barHeight, avatarSize, ring, barBg, numberColor }) =>
        tipster ? (
          <Link
            key={tipster.id}
            to={`/u/${tipster.username}`}
            className="max-w-[220px] flex-1 text-center"
          >
            {place === 1 && <div className="mb-1 text-[18px]">👑</div>}
            <Avatar
              name={tipster.displayName}
              seed={tipster.id}
              src={tipster.avatarUrl}
              size={avatarSize}
              className={`mx-auto border-2 ${ring}`}
            />
            <div className={`mt-2 font-semibold ${place === 1 ? "text-[15px]" : "text-[14px]"}`}>
              {tipster.displayName}
            </div>
            <div className={`font-mono font-bold text-accent ${place === 1 ? "text-[18px]" : "text-[15px]"}`}>
              {tipster.roi >= 0 ? "+" : ""}
              {tipster.roi.toFixed(0)}%
            </div>
            <div
              className={`mt-2.5 flex items-center justify-center rounded-t-xl bg-gradient-to-b font-mono font-bold ${barBg} ${numberColor}`}
              style={{ height: barHeight, fontSize: place === 1 ? 28 : 22 }}
            >
              {place}
            </div>
          </Link>
        ) : (
          <div key={`empty-${place}`} className="flex-1" />
        ),
      )}
    </div>
  );
}

function DesktopRankingTable({ ranking }: { ranking: RankedTipster[] }) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3 font-mono text-[10px] tracking-[0.06em] text-text-tertiary">
        <span className="w-9">#</span>
        <span className="flex-1">TIPSTER</span>
        <span className="w-[110px] text-right">TIPS</span>
        <span className="w-[100px] text-right">WINRATE</span>
        <span className="w-[100px] text-right">ROI 30D</span>
      </div>
      {ranking.slice(3).map((tipster, i) => (
        <Link
          key={tipster.id}
          to={`/u/${tipster.username}`}
          className="flex items-center gap-3 border-b border-border-subtle px-5 py-3.5 last:border-b-0"
        >
          <span className="w-9 font-mono text-[14px] text-text-tertiary">{i + 4}</span>
          <div className="flex flex-1 items-center gap-3">
            <Avatar name={tipster.displayName} seed={tipster.id} src={tipster.avatarUrl} size={38} />
            <div>
              <div className="flex items-center gap-1.5 text-[14px] font-semibold">
                {tipster.displayName}
                {tipster.verifiedAt && <VerifiedBadge size={13} />}
              </div>
              <div className="font-mono text-[11px] text-text-tertiary">@{tipster.username}</div>
            </div>
          </div>
          <span className="w-[110px] text-right font-mono text-[13px] text-text-muted">
            {tipster.tipsCount}
          </span>
          <span className="w-[100px] text-right font-mono text-[13px] text-text-muted">
            {tipster.hitRate.toFixed(0)}%
          </span>
          <span className="w-[100px] text-right font-mono text-[15px] font-bold text-accent">
            {tipster.roi >= 0 ? "+" : ""}
            {tipster.roi.toFixed(1)}%
          </span>
        </Link>
      ))}
    </div>
  );
}

const filters = [
  { key: "roi", label: "ROI 30d" },
  { key: "hitrate", label: "Assertividade" },
  { key: "seguidores", label: "Seguidores" },
  { key: "futebol", label: "Futebol" },
] as const;

function Podium({ top3 }: { top3: RankedTipster[] }) {
  const [first, second, third] = [top3[0], top3[1], top3[2]];
  const order = [second, first, third];

  return (
    <div className="flex items-end justify-center gap-2.5 px-5 pb-4">
      {order.map((tipster, i) =>
        tipster ? (
          <Link
            key={tipster.id}
            to={`/u/${tipster.username}`}
            className="flex flex-1 flex-col items-center text-center"
          >
            {i === 1 && (
              <div className="mb-0.5 text-vip">
                <IconCrown size={14} />
              </div>
            )}
            <Avatar
              name={tipster.displayName}
              seed={tipster.id}
              src={tipster.avatarUrl}
              size={i === 1 ? 64 : 54}
            />
            <div className="mt-1.5 truncate text-[12px] font-semibold">
              {tipster.displayName.split(" ")[0]}
            </div>
            <div className="font-mono text-[13px] font-bold text-accent">
              {tipster.roi >= 0 ? "+" : ""}
              {tipster.roi.toFixed(0)}%
            </div>
          </Link>
        ) : (
          <div key={`empty-${i}`} className="flex-1" />
        ),
      )}
    </div>
  );
}

type RankingFilter = (typeof filters)[number]["key"];

const subtitles: Record<RankingFilter, string> = {
  roi: "Por ROI · últimos 30 dias",
  hitrate: "Por assertividade · últimos 30 dias",
  seguidores: "Por seguidores",
  futebol: "Futebol · últimos 30 dias",
};

export function RankingPage() {
  const [filter, setFilter] = useState<RankingFilter>("roi");
  const [ranking, setRanking] = useState<RankedTipster[] | null>(null);

  useEffect(() => {
    // The backend only sorts by roi/hitrate; "seguidores" and "futebol" are
    // derived client-side from that same payload (followers is already on
    // it; futebol has no other sport to exclude yet, so it's just the roi list).
    const backendSort = filter === "hitrate" ? "hitrate" : "roi";
    fetchRanking(backendSort).then((data) => {
      setRanking(filter === "seguidores" ? [...data].sort((a, b) => b.followers - a.followers) : data);
    });
  }, [filter]);

  return (
    <>
      {/* Desktop (D2) — header/filters share one row, bar-chart podium, full data table. */}
      <div className="hidden h-full flex-col lg:flex">
        <div className="flex flex-none items-center gap-3 border-b border-border px-8 py-[18px]">
          <span className="text-[22px] font-bold tracking-[-0.02em]">Ranking de Tipsters</span>
          <div className="ml-auto flex gap-2">
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-[11px] px-4 py-2 text-[13px] ${
                  filter === f.key ? "bg-accent font-semibold text-[#08090A]" : "bg-surface-alt text-text-secondary"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-1 gap-7 overflow-y-auto px-8 py-6">
          <div className="min-w-0 flex-1">
            {ranking === null && <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>}
            {ranking?.length === 0 && (
              <p className="py-10 text-center text-sm text-text-tertiary">
                Ainda não há tipsters com tips suficientes.
              </p>
            )}
            {ranking && ranking.length > 0 && (
              <>
                <DesktopPodium top3={ranking.slice(0, 3)} />
                <DesktopRankingTable ranking={ranking} />
              </>
            )}
          </div>

          {ranking && ranking.length > 0 && <DesktopRankingRail ranking={ranking} />}
        </div>
      </div>

      {/* Mobile — flat podium row + card list. */}
      <div className="pb-6 lg:hidden">
        <div className="px-5 pb-2 pt-3">
          <div className="text-[24px] font-bold tracking-[-0.02em]">Ranking</div>
          <div className="font-mono text-[11px] text-text-tertiary">{subtitles[filter]}</div>
        </div>

        <div className="flex gap-2 overflow-x-auto px-5 py-3">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`flex-none rounded-[10px] px-3.5 py-1.5 text-[12px] ${
                filter === f.key
                  ? "bg-accent font-semibold text-[#08090A]"
                  : "bg-surface-alt text-text-secondary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {ranking === null && <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>}
        {ranking?.length === 0 && (
          <p className="py-10 text-center text-sm text-text-tertiary">
            Ainda não há tipsters com tips suficientes.
          </p>
        )}

        {ranking && ranking.length > 0 && <Podium top3={ranking.slice(0, 3)} />}

        <div className="flex flex-col gap-2 px-4">
          {ranking?.slice(3).map((tipster, i) => (
            <Link
              key={tipster.id}
              to={`/u/${tipster.username}`}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3"
            >
              <span className="w-[18px] flex-none text-center font-mono text-[14px] text-text-tertiary">
                {i + 4}
              </span>
              <Avatar name={tipster.displayName} seed={tipster.id} src={tipster.avatarUrl} size={38} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-[14px] font-semibold">
                  {tipster.displayName}
                  {tipster.verifiedAt && <VerifiedBadge size={13} />}
                </div>
                <div className="font-mono text-[11px] text-text-tertiary">
                  {tipster.tipsCount} tips · {tipster.hitRate.toFixed(0)}% win
                </div>
              </div>
              <div className="font-mono text-[15px] font-bold text-accent">
                {tipster.roi >= 0 ? "+" : ""}
                {tipster.roi.toFixed(1)}%
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
