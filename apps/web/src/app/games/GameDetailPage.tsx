import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchGameDetail, type GameDetail, type LiveGame, type TeamFormEntry } from "../../lib/gamesLive";
import { formatOdds } from "../../lib/format";
import { CrestName, onCrestError } from "../../components/CrestName";
import { FavoriteStar } from "../../components/FavoriteStar";
import { IconChevronLeft, IconCornerFlag, IconLive, IconPennant } from "../../components/Icon";
import { ApiError } from "../../lib/api";
import { todayIsoSaoPaulo } from "../../lib/dates";

// Live/finished games change fast enough to be worth polling, same cadence
// as the games list this page was reached from.
const REFRESH_MS = 30_000;

const RESULT_STYLE: Record<TeamFormEntry["result"], { label: string; className: string }> = {
  W: { label: "V", className: "bg-accent text-[#08090A]" },
  D: { label: "E", className: "bg-vip text-[#08090A]" },
  L: { label: "D", className: "bg-live text-[#08090A]" },
};

/** One colored dot per past result, oldest → newest — the "forma do time" strip. */
function FormDots({ form }: { form: TeamFormEntry[] | null }) {
  if (form === null) {
    return <div className="flex gap-1">{Array.from({ length: 5 }).map((_, i) => <span key={i} className="h-2 w-2 rounded-full bg-surface-chip" />)}</div>;
  }
  if (form.length === 0) {
    return <span className="text-[10.5px] text-text-tertiary">Sem jogos recentes</span>;
  }
  return (
    <div className="flex items-center gap-1">
      {form.map((entry) => (
        <span
          key={entry.gameId}
          title={`${entry.result === "W" ? "Vitória" : entry.result === "D" ? "Empate" : "Derrota"} · ${entry.isHome ? "vs " : "@ "}${entry.opponent} (${entry.scoreFor}-${entry.scoreAgainst})`}
          className={`h-2 w-2 flex-none rounded-full ${
            entry.result === "W" ? "bg-accent" : entry.result === "D" ? "bg-vip" : "bg-live"
          }`}
        />
      ))}
    </div>
  );
}

/** Same last-5 strip, but as labeled chips with opponent + score — used in the "Forma dos times" card. */
function FormList({ form }: { form: TeamFormEntry[] | null }) {
  if (form === null) return <p className="py-4 text-center text-[12px] text-text-tertiary">Carregando…</p>;
  if (form.length === 0) return <p className="py-4 text-center text-[12px] text-text-tertiary">Sem jogos recentes.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {[...form].reverse().map((entry) => (
        <div key={entry.gameId} className="flex items-center gap-2.5 rounded-lg bg-surface-chip px-2.5 py-2">
          <span
            className={`flex h-5 w-5 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold ${RESULT_STYLE[entry.result].className}`}
          >
            {RESULT_STYLE[entry.result].label}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px]">
            {entry.isHome ? "vs " : "@ "}
            {entry.opponent}
          </span>
          <span className="flex-none font-mono text-[12px] font-bold">
            {entry.scoreFor}-{entry.scoreAgainst}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatPairRow({
  label,
  home,
  away,
  icon,
}: {
  label: string;
  home: number | null;
  away: number | null;
  icon?: React.ReactNode;
}) {
  if (home === null && away === null) return null;
  const total = (home ?? 0) + (away ?? 0) || 1;
  const homePct = ((home ?? 0) / total) * 100;
  return (
    <div className="py-2.5">
      <div className="mb-1.5 flex items-center justify-between font-mono text-[12px] font-bold">
        <span>{home ?? "—"}</span>
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold text-text-secondary">
          {icon}
          {label}
        </span>
        <span>{away ?? "—"}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-chip">
        <div className="bg-accent" style={{ width: `${homePct}%` }} />
        <div className="bg-live" style={{ width: `${100 - homePct}%` }} />
      </div>
    </div>
  );
}

function ScoreHeader({ game, homeForm, awayForm }: { game: LiveGame; homeForm: TeamFormEntry[] | null; awayForm: TeamFormEntry[] | null }) {
  const isLive = game.status === "live";
  const isFinished = game.status === "finished";
  const showScore = isLive || isFinished;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-center gap-1.5 font-mono text-[11px] text-text-tertiary">
        <IconPennant size={12} className="text-accent" />
        {game.league}
        <FavoriteStar
          kind="league"
          externalId={game.leagueId}
          name={game.league}
          imageUrl={game.leagueImageUrl}
          size={13}
          className="-my-1"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-1 flex-col items-center gap-1.5 text-center">
          <img
            src={game.homeImageUrl}
            onError={onCrestError}
            alt=""
            className="h-11 w-11 rounded-full bg-surface-chip object-contain"
          />
          <span className="flex items-center gap-0.5">
            <span className="line-clamp-2 text-[13px] font-semibold">{game.homeTeam}</span>
            <FavoriteStar kind="team" externalId={game.homeId} name={game.homeTeam} imageUrl={game.homeImageUrl} size={13} />
          </span>
          <FormDots form={homeForm} />
        </div>

        <div className="flex flex-none flex-col items-center gap-1 px-2">
          {showScore ? (
            <span className="font-mono text-[26px] font-bold">
              {game.scoreHome ?? 0} <span className="text-text-quaternary">×</span> {game.scoreAway ?? 0}
            </span>
          ) : (
            <span className="text-[13px] font-semibold text-text-tertiary">
              {new Date(game.kickoff).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {isLive && (
            <span className="flex items-center gap-1 font-mono text-[11px] font-bold text-live">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
              {game.minute ?? 0}'
            </span>
          )}
          {isFinished && <span className="font-mono text-[10.5px] text-text-quaternary">FIM</span>}
        </div>

        <div className="flex flex-1 flex-col items-center gap-1.5 text-center">
          <img
            src={game.awayImageUrl}
            onError={onCrestError}
            alt=""
            className="h-11 w-11 rounded-full bg-surface-chip object-contain"
          />
          <span className="flex items-center gap-0.5">
            <span className="line-clamp-2 text-[13px] font-semibold">{game.awayTeam}</span>
            <FavoriteStar kind="team" externalId={game.awayId} name={game.awayTeam} imageUrl={game.awayImageUrl} size={13} />
          </span>
          <FormDots form={awayForm} />
        </div>
      </div>
    </div>
  );
}

function AboutCard({ game }: { game: LiveGame }) {
  const kickoff = new Date(game.kickoff);
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-1.5 text-[13px] font-bold">Sobre o confronto</div>
      <p className="text-[12.5px] leading-relaxed text-text-secondary">
        {game.homeTeam} enfrenta o {game.awayTeam} no dia{" "}
        {kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} às{" "}
        {kickoff.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}.
        O confronto vale pela {game.league}.
      </p>
    </div>
  );
}

function OddsCard({ game }: { game: LiveGame }) {
  if (game.oddHome === null) return null;
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">ODDS 1X2</div>
      <div className="flex gap-2">
        <div className="flex-1 rounded-xl bg-surface-chip p-2.5 text-center">
          <div className="mb-1 text-[10px] text-text-tertiary">Casa</div>
          <div className="font-mono text-[15px] font-bold text-accent">{formatOdds(game.oddHome)}</div>
        </div>
        <div className="flex-1 rounded-xl bg-surface-chip p-2.5 text-center">
          <div className="mb-1 text-[10px] text-text-tertiary">Empate</div>
          <div className="font-mono text-[15px] font-bold">{game.oddDraw !== null ? formatOdds(game.oddDraw) : "—"}</div>
        </div>
        <div className="flex-1 rounded-xl bg-surface-chip p-2.5 text-center">
          <div className="mb-1 text-[10px] text-text-tertiary">Fora</div>
          <div className="font-mono text-[15px] font-bold text-live">{game.oddAway !== null ? formatOdds(game.oddAway) : "—"}</div>
        </div>
      </div>
    </div>
  );
}

function StatsCard({ game }: { game: LiveGame }) {
  if (game.cornersHome === null && game.yellowHome === null) return null;
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-1 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">ESTATÍSTICAS</div>
      <div className="divide-y divide-border-subtle">
        <StatPairRow label="Escanteios" home={game.cornersHome} away={game.cornersAway} icon={<IconCornerFlag size={11} />} />
        <StatPairRow label="Cartões amarelos" home={game.yellowHome} away={game.yellowAway} />
        <StatPairRow label="Cartões vermelhos" home={game.redHome} away={game.redAway} />
      </div>
    </div>
  );
}

function FormCard({ game, homeForm, awayForm }: { game: LiveGame; homeForm: TeamFormEntry[] | null; awayForm: TeamFormEntry[] | null }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">FORMA DOS TIMES · ÚLTIMOS 5 JOGOS</div>
      <div className="flex flex-col gap-4">
        <div>
          <CrestName src={game.homeImageUrl} name={game.homeTeam} />
          <div className="mt-2">
            <FormList form={homeForm} />
          </div>
        </div>
        <div>
          <CrestName src={game.awayImageUrl} name={game.awayTeam} />
          <div className="mt-2">
            <FormList form={awayForm} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function GameDetailPage() {
  const { gameId = "" } = useParams<{ gameId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const date = searchParams.get("date") || todayIsoSaoPaulo();
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setNotFound(false);

    function load() {
      fetchGameDetail(gameId, date)
        .then((res) => {
          if (!cancelled) setDetail(res);
        })
        .catch((err) => {
          if (!cancelled && err instanceof ApiError && err.status === 404) setNotFound(true);
        });
    }
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [gameId, date]);

  const game = detail?.game ?? null;

  return (
    <div className="min-h-dvh bg-bg text-text lg:flex lg:min-h-full lg:flex-col">
      {/* ---------- Mobile ---------- */}
      <div className="lg:hidden">
        <div className="flex items-center gap-3 px-5 pb-1 pt-14">
          <button onClick={() => navigate(-1)} aria-label="Voltar">
            <IconChevronLeft size={20} />
          </button>
          <span className="text-[16px] font-bold tracking-[-0.02em]">Estatísticas do jogo</span>
        </div>

        {notFound && (
          <p className="px-5 py-10 text-center text-sm text-text-tertiary">
            Não encontramos esse jogo. Ele pode já ter saído da lista do dia.
          </p>
        )}

        {!notFound && game === null && (
          <p className="px-5 py-10 text-center text-sm text-text-tertiary">Carregando…</p>
        )}

        {game && (
          <div className="flex flex-col gap-3 px-4 pb-8 pt-2">
            <ScoreHeader game={game} homeForm={detail?.homeForm ?? null} awayForm={detail?.awayForm ?? null} />
            <AboutCard game={game} />
            <OddsCard game={game} />
            <StatsCard game={game} />
            <FormCard game={game} homeForm={detail?.homeForm ?? null} awayForm={detail?.awayForm ?? null} />
          </div>
        )}
      </div>

      {/* ---------- Desktop ---------- */}
      <div className="hidden lg:flex lg:flex-1 lg:flex-col">
        <div className="sticky top-0 z-10 flex-none border-b border-border bg-bg">
          <div className="flex h-[70px] items-center gap-3 px-8">
            <button
              onClick={() => navigate(-1)}
              aria-label="Voltar"
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-border-strong text-text-secondary"
            >
              <IconChevronLeft size={16} />
            </button>
            <span className="text-[20px] font-bold tracking-[-0.02em]">Estatísticas do jogo</span>
            {game && (
              <span className="ml-2 flex items-center gap-1.5 font-mono text-[12px] text-text-tertiary">
                <IconLive size={12} className={game.status === "live" ? "text-live" : "text-text-quaternary"} />
                {game.league}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 px-8 py-6">
          {notFound && (
            <p className="py-10 text-center text-sm text-text-tertiary">
              Não encontramos esse jogo. Ele pode já ter saído da lista do dia.
            </p>
          )}
          {!notFound && game === null && (
            <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>
          )}
          {game && (
            <div className="mx-auto flex w-full max-w-[900px] gap-6">
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <ScoreHeader game={game} homeForm={detail?.homeForm ?? null} awayForm={detail?.awayForm ?? null} />
                <AboutCard game={game} />
                <OddsCard game={game} />
              </div>
              <div className="flex w-[340px] flex-none flex-col gap-4">
                <StatsCard game={game} />
                <FormCard game={game} homeForm={detail?.homeForm ?? null} awayForm={detail?.awayForm ?? null} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
