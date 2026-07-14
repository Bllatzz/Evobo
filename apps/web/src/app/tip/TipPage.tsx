import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  fetchComments,
  fetchTip,
  followUser,
  postComment,
  takeTip,
  unfollowUser,
  untakeTip,
  type FeedComment,
  type TipDetail,
} from "../../lib/tips";
import { formatConfidence, formatOdds, formatUnits, timeAgo } from "../../lib/format";
import { Avatar } from "../../components/Avatar";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { IconCheck, IconChevronLeft, IconSparkle } from "../../components/Icon";
import { useAuth } from "../../stores/auth";

function TipAuthorRow({
  tip,
  isOwnTip,
  onFollowToggle,
  avatarSize,
}: {
  tip: TipDetail;
  isOwnTip: boolean;
  onFollowToggle: () => void;
  avatarSize: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar name={tip.author.displayName} seed={tip.author.id} src={tip.author.avatarUrl} size={avatarSize} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[15px] font-semibold lg:text-[16px]">
          {tip.author.displayName}
          {tip.author.verifiedAt && <VerifiedBadge />}
        </div>
        <div className="font-mono text-[12.5px] text-text-tertiary">
          @{tip.author.username} · {timeAgo(tip.createdAt)}
        </div>
      </div>
      {!isOwnTip && (
        <button
          onClick={onFollowToggle}
          className={`rounded-[11px] px-3.5 py-1.5 text-[13px] font-semibold ${
            tip.followedByMe ? "border border-border-strong text-text-secondary" : "border border-accent text-accent"
          }`}
        >
          {tip.followedByMe ? "Seguindo" : "Seguir"}
        </button>
      )}
    </div>
  );
}

function TipMatchBanner({
  tip,
  confidenceLabel,
  oddSize,
}: {
  tip: TipDetail;
  confidenceLabel: string | null;
  oddSize: "sm" | "lg";
}) {
  const lg = oddSize === "lg";
  return (
    <div className={`rounded-[20px] border border-border bg-surface ${lg ? "p-[22px]" : "p-4"}`}>
      <div className="mb-3 flex justify-between font-mono text-[10px] text-text-tertiary lg:mb-4.5">
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
      <div className="mb-4 flex items-center justify-between lg:mb-5">
        <span className={`font-semibold ${lg ? "text-[18px]" : "text-[16px]"}`}>{tip.match.homeTeam}</span>
        <span className={`font-mono text-text-quaternary ${lg ? "text-[24px]" : "text-[13px]"}`}>
          {tip.match.scoreHome ?? "·"} : {tip.match.scoreAway ?? "·"}
        </span>
        <span className={`font-semibold ${lg ? "text-[18px]" : "text-[16px]"}`}>{tip.match.awayTeam}</span>
      </div>
      <div className="flex items-stretch gap-3 lg:gap-4">
        <div className="flex-1">
          <div className="mb-0.5 font-mono text-[9px] tracking-[0.08em] text-text-tertiary">MERCADO</div>
          <div className={`mb-2 font-semibold ${lg ? "text-[22px]" : "text-[18px]"}`}>{tip.market}</div>
          <div className="flex gap-2">
            <span className="rounded-lg bg-surface-alt px-2.5 py-1 font-mono text-[11px] text-text-secondary">
              Stake {formatUnits(tip.stakeUnits)}
            </span>
            {confidenceLabel && (
              <span className="rounded-lg bg-accent-soft px-2.5 py-1 font-mono text-[11px] text-accent">
                {confidenceLabel}
              </span>
            )}
          </div>
        </div>
        <div
          className={`flex flex-none flex-col items-center justify-center rounded-[14px] border border-accent-border bg-accent-soft ${lg ? "w-[130px]" : "w-[90px]"}`}
        >
          <span className="text-[9px] text-text-secondary">ODD</span>
          <span className={`font-mono font-bold leading-none text-accent ${lg ? "text-[38px]" : "text-[28px]"}`}>
            {formatOdds(tip.odds)}
          </span>
        </div>
      </div>
    </div>
  );
}

function TipActionsRow({
  tip,
  onTake,
  onUntake,
  size,
}: {
  tip: TipDetail;
  onTake: () => void;
  onUntake: () => void;
  size: "sm" | "lg";
}) {
  const lg = size === "lg";
  return (
    <div className={`flex gap-2.5 ${lg ? "mt-5" : ""}`}>
      <button
        onClick={onTake}
        className={`flex flex-1 items-center justify-center gap-2 rounded-[14px] font-semibold ${lg ? "h-[52px] text-[15px]" : "h-12 text-[15px]"} ${
          tip.takenByMe ? "bg-accent text-[#08090A]" : "border border-border-strong text-text"
        }`}
      >
        {tip.takenByMe && <IconCheck size={14} className="mr-1.5 inline" />}Peguei · {tip._count.takes}
      </button>
      <button
        onClick={onUntake}
        className={`flex-none rounded-[14px] ${lg ? "h-[52px] w-[150px] text-[14px]" : "h-12 w-[110px] text-[14px]"} ${
          !tip.takenByMe ? "border border-border-strong text-text-secondary" : "text-text-tertiary"
        }`}
      >
        Não peguei
      </button>
      <Link
        to={`/tip/${tip.id}/ai-analysis`}
        className={`flex flex-none items-center justify-center gap-2 rounded-[14px] border border-verified/40 bg-verified-soft font-semibold text-verified ${
          lg ? "h-[52px] w-[190px] text-[14px]" : "hidden"
        }`}
      >
        <IconSparkle size={15} /> Análise IA
      </Link>
    </div>
  );
}

function CommentRow({ comment }: { comment: FeedComment }) {
  return (
    <div className="flex gap-2.5">
      <Avatar name={comment.author.displayName} seed={comment.author.id} src={comment.author.avatarUrl} size={32} />
      <div className="flex-1">
        <div className="rounded-[13px] bg-surface-alt px-3 py-2.5">
          <div className="mb-0.5 text-[12px] font-semibold">{comment.author.displayName}</div>
          <p className="text-[13.5px] leading-snug text-text-muted">{comment.content}</p>
        </div>
        <div className="mt-1 px-1 font-mono text-[11px] text-text-tertiary">{timeAgo(comment.createdAt)}</div>
      </div>
    </div>
  );
}

export function TipPage() {
  const { tipId } = useParams<{ tipId: string }>();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [tip, setTip] = useState<TipDetail | null>(null);
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(() => {
    if (!tipId) return () => {};
    let cancelled = false;
    fetchTip(tipId)
      .then((data) => {
        if (!cancelled) {
          setTip(data);
          setNotFound(false);
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    fetchComments(tipId)
      .then((data) => {
        if (!cancelled) setComments(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tipId]);

  // Reset before fetching so a slow response for a tip the user already
  // navigated away from can't land on top of the new tip's data.
  useEffect(() => {
    setTip(null);
    setComments(null);
    setNotFound(false);
    return load();
  }, [tipId, load]);

  async function handleTakeToggle(take: boolean) {
    if (!tip || toggling) return;
    setToggling(true);
    try {
      if (take) await takeTip(tip.id);
      else await untakeTip(tip.id);
      load();
    } finally {
      setToggling(false);
    }
  }

  async function handleFollowToggle() {
    if (!tip || toggling) return;
    setToggling(true);
    try {
      if (tip.followedByMe) await unfollowUser(tip.author.id);
      else await followUser(tip.author.id);
      load();
    } finally {
      setToggling(false);
    }
  }

  async function handleSubmitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!tip || !draft.trim() || posting) return;
    setPosting(true);
    try {
      await postComment(tip.id, draft.trim());
      setDraft("");
      load();
    } catch {
      // keep the draft so the user doesn't lose what they typed
    } finally {
      setPosting(false);
    }
  }

  if (notFound) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-text">
        <p className="text-[14px] text-text-secondary">Essa tip não existe mais ou foi removida.</p>
        <Link to="/" className="text-[13px] font-semibold text-accent">
          Voltar para o feed
        </Link>
      </div>
    );
  }

  if (!tip) {
    return <div className="min-h-dvh bg-bg" />;
  }

  const confidenceLabel = formatConfidence(tip.confidence);
  const isOwnTip = me?.id === tip.author.id;

  return (
    <div className="min-h-dvh bg-bg text-text lg:flex lg:h-dvh lg:flex-col">
      {/* ---------- Desktop ---------- */}
      <div className="hidden lg:flex lg:h-[70px] lg:flex-none lg:items-center lg:gap-3 lg:border-b lg:border-border lg:px-8">
        <span className="text-[20px] font-bold tracking-[-0.02em]">Tip</span>
        <span className="font-mono text-[12px] text-text-tertiary">
          Publicada {timeAgo(tip.createdAt)}
        </span>
      </div>

      <div className="hidden lg:flex lg:min-h-0 lg:flex-1 lg:gap-7 lg:overflow-y-auto lg:px-8 lg:py-6">
        <div className="min-w-0 flex-1">
          <TipAuthorRow tip={tip} isOwnTip={isOwnTip} onFollowToggle={handleFollowToggle} avatarSize={48} />
          <div className="mt-5">
            <TipMatchBanner tip={tip} confidenceLabel={confidenceLabel} oddSize="lg" />
          </div>
          {tip.analysisText && (
            <div className="mt-5 rounded-2xl border border-border bg-surface-chip p-[22px]">
              <div className="mb-2.5 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
                ANÁLISE
              </div>
              <p className="text-[15px] leading-relaxed text-text-muted">{tip.analysisText}</p>
            </div>
          )}
          <TipActionsRow
            tip={tip}
            onTake={() => handleTakeToggle(true)}
            onUntake={() => handleTakeToggle(false)}
            size="lg"
          />
        </div>

        <div className="flex w-[320px] flex-none flex-col rounded-2xl border border-border bg-surface-chip p-[18px]">
          <div className="mb-4 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
            COMENTÁRIOS · {comments?.length ?? tip._count.comments}
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
            {comments?.map((comment) => (
              <CommentRow key={comment.id} comment={comment} />
            ))}
          </div>
          {me && (
            <form onSubmit={handleSubmitComment} className="mt-4 flex items-center gap-2.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Escreva um comentário…"
                className="h-[42px] flex-1 rounded-[13px] border border-border-strong bg-surface-alt px-3.5 text-[13px] text-text outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={posting || !draft.trim()}
                className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full bg-accent text-[16px] text-[#08090A] disabled:opacity-50"
                aria-label="Enviar comentário"
              >
                ↑
              </button>
            </form>
          )}
        </div>
      </div>

      {/* ---------- Mobile ---------- */}
      <div className="pb-24 lg:hidden">
      <div className="flex items-center gap-3.5 border-b border-border px-4 pb-3 pt-14">
        <button onClick={() => navigate(-1)} aria-label="Voltar">
          <IconChevronLeft size={22} />
        </button>
        <span className="text-[16px] font-semibold">Tip</span>
      </div>

      <div className="flex flex-col gap-3.5 p-4">
        <TipAuthorRow tip={tip} isOwnTip={isOwnTip} onFollowToggle={handleFollowToggle} avatarSize={44} />

        <TipMatchBanner tip={tip} confidenceLabel={confidenceLabel} oddSize="sm" />

        {tip.analysisText && (
          <div className="rounded-2xl border border-border bg-surface p-3.5">
            <div className="mb-2 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
              ANÁLISE
            </div>
            <p className="text-[14px] leading-relaxed text-text-muted">{tip.analysisText}</p>
          </div>
        )}

        <TipActionsRow
          tip={tip}
          onTake={() => handleTakeToggle(true)}
          onUntake={() => handleTakeToggle(false)}
          size="sm"
        />

        <Link
          to={`/tip/${tip.id}/ai-analysis`}
          className="flex h-[46px] items-center justify-center gap-2 rounded-[14px] border border-verified/40 bg-verified-soft text-[14px] font-semibold text-verified"
        >
          <IconSparkle size={15} /> Análise IA completa
        </Link>

        {/* comments */}
        <div className="pt-1">
          <div className="mb-3 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
            COMENTÁRIOS · {comments?.length ?? tip._count.comments}
          </div>

          <div className="flex flex-col gap-3.5">
            {comments?.map((comment) => (
              <CommentRow key={comment.id} comment={comment} />
            ))}
          </div>
        </div>
      </div>

      {me && (
        <form
          onSubmit={handleSubmitComment}
          className="fixed bottom-0 left-0 right-0 mx-auto flex max-w-[480px] items-center gap-2.5 border-t border-border bg-bg px-4 py-3"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Comentar…"
            className="h-[42px] flex-1 rounded-full border border-border-strong bg-surface-alt px-4 text-[13.5px] text-text outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={posting || !draft.trim()}
            className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full bg-accent text-[16px] text-[#08090A] disabled:opacity-50"
            aria-label="Enviar comentário"
          >
            ↑
          </button>
        </form>
      )}
      </div>
    </div>
  );
}
