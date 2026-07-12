import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchProfile, fetchProfileTips, type ProfileDetail, type ProfileTip } from "../../lib/profile";
import { followUser, unfollowUser } from "../../lib/tips";
import { formatOdds, formatUnits } from "../../lib/format";
import { Avatar } from "../../components/Avatar";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { IconCheck, IconChevronLeft, IconX } from "../../components/Icon";
import { useAuth } from "../../stores/auth";

const resultLabel: Record<string, { text: string; className: string; Icon?: typeof IconCheck }> = {
  green: { text: "Green", className: "text-accent", Icon: IconCheck },
  red: { text: "Red", className: "text-live", Icon: IconX },
  void: { text: "Anulada", className: "text-text-tertiary" },
  pending: { text: "Em aberto", className: "text-text-tertiary" },
};

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function tipProfit(tip: ProfileTip): number {
  const odds = Number(tip.odds);
  const stake = Number(tip.stakeUnits);
  if (tip.status === "green") return stake * (odds - 1);
  if (tip.status === "red") return -stake;
  return 0;
}

/** Real cumulative profit for this tipster's own published tips — same non-fabricated pattern as the Gráfico Robô / Meu Perfil charts. */
function ProfitChart({ settled }: { settled: ProfileTip[] }) {
  const chronological = [...settled].sort(
    (a, b) => new Date(a.resultSettledAt ?? a.createdAt).getTime() - new Date(b.resultSettledAt ?? b.createdAt).getTime(),
  );
  if (chronological.length < 2) {
    return (
      <div className="flex h-[150px] items-center justify-center text-[12px] text-text-tertiary">
        Poucas tips resolvidas para desenhar o gráfico.
      </div>
    );
  }

  let cumulative = 0;
  const values = chronological.map((tip) => {
    cumulative += tipProfit(tip);
    return cumulative;
  });
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const width = 800;
  const height = 150;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPoints = `0,${height} ${points.join(" ")} ${width},${height}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <defs>
        <linearGradient id="tipsterProfitFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.35" className="text-accent" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" className="text-accent" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#tipsterProfitFill)" />
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" className="text-accent" />
    </svg>
  );
}

export function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [profile, setProfile] = useState<ProfileDetail | null>(null);
  const [tips, setTips] = useState<ProfileTip[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [followToggling, setFollowToggling] = useState(false);

  const load = useCallback(() => {
    if (!username) return () => {};
    let cancelled = false;
    fetchProfile(username)
      .then((data) => {
        if (!cancelled) {
          setProfile(data);
          setNotFound(false);
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    fetchProfileTips(username)
      .then((data) => {
        if (!cancelled) setTips(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Reset before fetching so a slow response for a profile the user already
  // navigated away from can't land on top of the new profile's data.
  useEffect(() => {
    setProfile(null);
    setTips(null);
    setNotFound(false);
    return load();
  }, [username, load]);

  const settled = useMemo(
    () => tips?.filter((t) => t.status === "green" || t.status === "red") ?? null,
    [tips],
  );

  const extraStats = useMemo(() => {
    if (!settled) return null;
    const cutoff90 = Date.now() - NINETY_DAYS_MS;
    const cutoff30 = Date.now() - THIRTY_DAYS_MS;
    const last90 = settled.filter((t) => new Date(t.resultSettledAt ?? t.createdAt).getTime() >= cutoff90);
    const last30 = settled.filter((t) => new Date(t.resultSettledAt ?? t.createdAt).getTime() >= cutoff30);
    const profit90d = last90.reduce((sum, t) => sum + tipProfit(t), 0);
    const green30 = last30.filter((t) => t.status === "green").length;
    const red30 = last30.filter((t) => t.status === "red").length;
    const avgOdds30 =
      last30.length > 0 ? last30.reduce((sum, t) => sum + Number(t.odds), 0) / last30.length : null;
    return { profit90d, green30, red30, avgOdds30 };
  }, [settled]);

  if (notFound) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-text">
        <p className="text-[14px] text-text-secondary">Esse perfil não existe.</p>
        <Link to="/" className="text-[13px] font-semibold text-accent">
          Voltar para o feed
        </Link>
      </div>
    );
  }

  if (!profile) return <div className="min-h-dvh bg-bg" />;

  const isOwnProfile = me?.id === profile.id;

  async function handleFollowToggle() {
    if (!profile || followToggling) return;
    setFollowToggling(true);
    try {
      if (profile.followedByMe) await unfollowUser(profile.id);
      else await followUser(profile.id);
      load();
    } finally {
      setFollowToggling(false);
    }
  }

  return (
    <div className="min-h-dvh bg-bg text-text lg:flex lg:min-h-full lg:flex-col">
      {/* ---------- Desktop ---------- */}
      <div className="hidden lg:flex lg:h-[70px] lg:flex-none lg:items-center lg:gap-3 lg:border-b lg:border-border lg:px-8">
        <span className="text-[20px] font-bold tracking-[-0.02em]">Perfil do tipster</span>
        <button className="ml-auto rounded-[11px] border border-border-strong px-4.5 py-2 text-[13px] text-text-secondary">
          Compartilhar
        </button>
      </div>

      <div className="hidden lg:flex lg:flex-1 lg:gap-7 lg:px-8 lg:py-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-4.5">
            <Avatar name={profile.displayName} seed={profile.id} src={profile.avatarUrl} size={84} />
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[26px] font-bold tracking-[-0.02em]">{profile.displayName}</span>
                {profile.verifiedAt && <VerifiedBadge size={19} />}
              </div>
              <div className="my-1 font-mono text-[13px] text-text-tertiary">
                @{profile.username} · {profile.followers} seguidores
              </div>
              {profile.bio && <p className="text-[14px] text-text-secondary">{profile.bio}</p>}
            </div>
            {!isOwnProfile && (
              <div className="flex flex-none gap-2.5">
                <button
                  onClick={handleFollowToggle}
                  className={`h-11 rounded-xl px-5 text-[14px] font-semibold ${
                    profile.followedByMe
                      ? "border border-border-strong text-text-secondary"
                      : "bg-accent text-[#08090A]"
                  }`}
                >
                  {profile.followedByMe ? "Seguindo" : "Seguir"}
                </button>
                <button
                  disabled
                  title="Disponível quando o grupo VIP estiver ativo"
                  className="h-11 rounded-xl border border-vip-border bg-vip-soft px-5 text-[14px] font-semibold text-vip opacity-60"
                >
                  Assinar VIP
                </button>
              </div>
            )}
          </div>

          <div className="mt-5 flex gap-3.5">
            <div className="flex-1 rounded-[14px] border border-border bg-surface-chip p-4 text-center">
              <div className={`font-mono text-[22px] font-bold ${profile.roi >= 0 ? "text-accent" : "text-live"}`}>
                {profile.roi >= 0 ? "+" : ""}
                {profile.roi.toFixed(1)}%
              </div>
              <div className="mt-1 font-mono text-[10px] text-text-tertiary">ROI 30D</div>
            </div>
            <div className="flex-1 rounded-[14px] border border-border bg-surface-chip p-4 text-center">
              <div className="font-mono text-[22px] font-bold">{profile.hitRate.toFixed(0)}%</div>
              <div className="mt-1 font-mono text-[10px] text-text-tertiary">ASSERTIVIDADE</div>
            </div>
            <div className="flex-1 rounded-[14px] border border-border bg-surface-chip p-4 text-center">
              <div className="font-mono text-[22px] font-bold">{profile.tipsCount}</div>
              <div className="mt-1 font-mono text-[10px] text-text-tertiary">TIPS</div>
            </div>
            <div className="flex-1 rounded-[14px] border border-border bg-surface-chip p-4 text-center">
              <div
                className={`font-mono text-[22px] font-bold ${(extraStats?.profit90d ?? 0) >= 0 ? "text-accent" : "text-live"}`}
              >
                {extraStats ? `${extraStats.profit90d >= 0 ? "+" : ""}${extraStats.profit90d.toFixed(0)}u` : "—"}
              </div>
              <div className="mt-1 font-mono text-[10px] text-text-tertiary">LUCRO 90D</div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-border bg-surface-chip p-5">
            <div className="mb-3.5 flex items-center justify-between">
              <span className="font-mono text-[12px] tracking-[0.06em] text-text-tertiary">
                EVOLUÇÃO DE LUCRO · 90 DIAS
              </span>
              <span className={`font-mono text-[14px] font-bold ${(extraStats?.profit90d ?? 0) >= 0 ? "text-accent" : "text-live"}`}>
                {extraStats ? `${extraStats.profit90d >= 0 ? "+" : ""}${extraStats.profit90d.toFixed(0)}u` : "—"}
              </span>
            </div>
            <ProfitChart settled={settled ?? []} />
          </div>

          <div className="mt-5 border-b border-border text-[14px] font-semibold">
            <span className="border-b-2 border-accent pb-2.5">Tips públicas</span>
          </div>
          <div className="mt-4 flex flex-col gap-2.5">
            {tips === null && <p className="py-8 text-center text-sm text-text-tertiary">Carregando…</p>}
            {tips?.length === 0 && (
              <p className="py-8 text-center text-sm text-text-tertiary">Nenhuma tip pública ainda.</p>
            )}
            {tips?.map((tip) => {
              const result = resultLabel[tip.status] ?? resultLabel.pending!;
              return (
                <div
                  key={tip.id}
                  className="flex items-center justify-between rounded-[14px] border border-border bg-surface-chip px-4.5 py-3.5"
                >
                  <div>
                    <div className="mb-1 font-mono text-[10px] text-text-tertiary">
                      {tip.match.league.toUpperCase()}
                    </div>
                    <div className="text-[15px] font-semibold">
                      {tip.match.homeTeam} × {tip.match.awayTeam} · {tip.market}
                    </div>
                    <span className={`font-mono text-[11px] ${result.className}`}>{result.text}</span>
                  </div>
                  <span className="font-mono text-[19px] font-bold text-accent">{formatOdds(tip.odds)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="w-[300px] flex-none space-y-4">
          <div className="rounded-2xl border border-vip-border bg-gradient-to-br from-[#1A1508] to-surface p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[15px] font-bold text-vip">Grupo VIP</span>
            </div>
            <p className="mb-4 text-[13px] leading-relaxed text-text-muted">
              Tips exclusivas, análises com IA e entradas em tempo real.
            </p>
            <button
              disabled
              title="Disponível quando o grupo VIP estiver ativo"
              className="h-11 w-full rounded-xl bg-vip text-[14px] font-bold text-[#08090A] opacity-60"
            >
              Em breve
            </button>
          </div>

          <div className="rounded-2xl border border-border bg-surface-chip p-4.5">
            <div className="mb-3.5 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
              ÚLTIMOS 30 DIAS
            </div>
            <div className="mb-2.5 flex justify-between text-[13px]">
              <span className="text-text-muted">Green</span>
              <span className="font-mono font-bold text-accent">{extraStats?.green30 ?? "—"}</span>
            </div>
            <div className="mb-2.5 flex justify-between text-[13px]">
              <span className="text-text-muted">Red</span>
              <span className="font-mono font-bold text-live">{extraStats?.red30 ?? "—"}</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-text-muted">Odd média</span>
              <span className="font-mono font-bold">{extraStats?.avgOdds30?.toFixed(2) ?? "—"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Mobile ---------- */}
      <div className="pb-8 lg:hidden">
      <div className="flex items-center justify-between px-4 pb-3 pt-14">
        <button onClick={() => navigate(-1)} aria-label="Voltar">
          <IconChevronLeft size={22} />
        </button>
      </div>

      <div className="flex items-center gap-3.5 px-5 pb-4">
        <Avatar name={profile.displayName} seed={profile.id} src={profile.avatarUrl} size={62} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[18px] font-bold">
            {profile.displayName}
            {profile.verifiedAt && <VerifiedBadge />}
          </div>
          <div className="font-mono text-[11px] text-text-tertiary">
            @{profile.username} · {profile.followers} seguidores
          </div>
          {profile.bio && <p className="mt-1 text-[12px] text-text-secondary">{profile.bio}</p>}
        </div>
      </div>

      <div className="flex gap-2.5 px-5 pb-4">
        {isOwnProfile ? (
          <div className="h-11 flex-1" />
        ) : (
          <>
            <button
              onClick={handleFollowToggle}
              className={`h-11 flex-1 rounded-[14px] text-[14px] font-semibold ${
                profile.followedByMe
                  ? "border border-border-strong text-text-secondary"
                  : "bg-accent text-[#08090A]"
              }`}
            >
              {profile.followedByMe ? "Seguindo" : "Seguir"}
            </button>
            <button
              disabled
              title="Disponível quando o grupo VIP estiver ativo"
              className="h-11 flex-1 rounded-[14px] border border-vip-border bg-vip-soft text-[14px] font-semibold text-vip opacity-60"
            >
              Assinar VIP
            </button>
          </>
        )}
      </div>

      <div className="flex gap-2 px-5 pb-4">
        <div className="flex-1 rounded-2xl border border-border bg-surface p-3 text-center">
          <div className="font-mono text-[16px] font-bold text-accent">
            {profile.roi >= 0 ? "+" : ""}
            {profile.roi.toFixed(1)}%
          </div>
          <div className="mt-0.5 text-[9px] text-text-tertiary">ROI 30D</div>
        </div>
        <div className="flex-1 rounded-2xl border border-border bg-surface p-3 text-center">
          <div className="font-mono text-[16px] font-bold">{profile.hitRate.toFixed(0)}%</div>
          <div className="mt-0.5 text-[9px] text-text-tertiary">ASSERTIV.</div>
        </div>
        <div className="flex-1 rounded-2xl border border-border bg-surface p-3 text-center">
          <div className="font-mono text-[16px] font-bold">{profile.tipsCount}</div>
          <div className="mt-0.5 text-[9px] text-text-tertiary">TIPS</div>
        </div>
      </div>

      <div className="border-b border-border px-5 pb-2 text-[14px] font-semibold">
        <span className="border-b-2 border-accent pb-2">Tips públicas</span>
      </div>

      <div className="flex flex-col gap-2.5 px-4 pt-3.5">
        {tips === null && (
          <p className="py-8 text-center text-sm text-text-tertiary">Carregando…</p>
        )}
        {tips?.length === 0 && (
          <p className="py-8 text-center text-sm text-text-tertiary">Nenhuma tip pública ainda.</p>
        )}
        {tips?.map((tip) => {
          const result = resultLabel[tip.status] ?? resultLabel.pending!;
          return (
            <div
              key={tip.id}
              className="flex items-center justify-between rounded-2xl border border-border bg-surface p-3.5"
            >
              <div>
                <div className="font-mono text-[10px] text-text-tertiary">
                  {tip.match.league.toUpperCase()}
                </div>
                <div className="text-[14px] font-semibold">
                  {tip.match.homeTeam} x {tip.match.awayTeam} · {tip.market}
                </div>
                <span
                  className={`flex items-center gap-1 font-mono text-[10px] ${result.className}`}
                >
                  {result.Icon && <result.Icon size={10} />}
                  {result.text}
                </span>
              </div>
              <div className="text-right">
                <div className="font-mono text-[18px] font-bold text-accent">
                  {formatOdds(tip.odds)}
                </div>
                <div className="font-mono text-[10px] text-text-tertiary">
                  {formatUnits(tip.stakeUnits)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
