import { useEffect, useState, type SyntheticEvent } from "react";
import { useNavigate } from "react-router-dom";
import { fetchEvPicks, type EvPick } from "../../lib/evPlus";
import { IconChevronLeft, IconTrendingUp, IconPennant, IconSparkle } from "../../components/Icon";

const NOT_FOUND_CREST = "https://robotip.com.br/robotip_imgs/teams_imgs/not-found.png";

function onCrestError(e: SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.src = NOT_FOUND_CREST;
}

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PickCard({ pick }: { pick: EvPick }) {
  return (
    <div className="rounded-[18px] border border-border bg-surface p-3.5 lg:p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-text-tertiary">
          <IconPennant size={11} className="flex-none text-accent" />
          <span className="truncate">{pick.competition ?? "Competição desconhecida"}</span>
        </div>
        <span className="flex-none font-mono text-[10px] text-text-tertiary">
          {formatKickoff(pick.kickoff)}
        </span>
      </div>

      <div className="mb-3 flex items-center justify-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
          <img
            src={pick.homeImageUrl}
            onError={onCrestError}
            alt=""
            className="h-8 w-8 flex-none rounded-full bg-surface-chip object-contain"
          />
          <span className="w-full truncate text-[12px] font-semibold">{pick.homeTeam}</span>
        </div>
        <span className="flex-none text-[11px] text-text-quaternary">×</span>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
          <img
            src={pick.awayImageUrl}
            onError={onCrestError}
            alt=""
            className="h-8 w-8 flex-none rounded-full bg-surface-chip object-contain"
          />
          <span className="w-full truncate text-[12px] font-semibold">{pick.awayTeam}</span>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-accent-border bg-accent-soft px-3 py-2">
        <span className="min-w-0 truncate text-[13px] font-semibold">
          {pick.market}
          {pick.bookie && <span className="ml-1.5 font-mono text-[10px] text-text-tertiary">{pick.bookie}</span>}
        </span>
        <span className="flex-none font-mono text-[15px] font-bold text-accent">
          +{pick.evPct.toFixed(1)}%
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5 rounded-[10px] bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">Odd da casa</span>
          <span className="font-mono text-[14px] font-bold">{pick.oddBookie.toFixed(2)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">Odd justa (IA)</span>
          <span className="font-mono text-[14px] font-bold">{pick.oddFair.toFixed(2)}</span>
        </div>
      </div>

      {pick.analysis && (
        <p className="line-clamp-3 text-[12px] leading-relaxed text-text-secondary">{pick.analysis}</p>
      )}
    </div>
  );
}

export function EvPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ picks: EvPick[]; unavailable: boolean } | null>(null);

  useEffect(() => {
    fetchEvPicks().then(setData);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <div className="flex items-center gap-3 px-5 pb-1 pt-14 lg:px-8 lg:pt-6">
        <button onClick={() => navigate(-1)} className="lg:hidden" aria-label="Voltar">
          <IconChevronLeft size={22} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 text-[24px] font-bold tracking-[-0.02em]">
            EV<span className="text-accent">+</span>
          </div>
          <div className="font-mono text-[11px] text-text-tertiary">Valor esperado positivo · IA</div>
        </div>
        {data && data.picks.length > 0 && (
          <span className="flex-none font-mono text-[11px] text-accent">
            {data.picks.length} {data.picks.length === 1 ? "pick" : "picks"}
          </span>
        )}
      </div>

      <div className="flex-1 px-5 py-4 lg:px-8 lg:py-6">
        <div className="mx-auto flex w-full max-w-[900px] flex-col">
          {data === null && (
            <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>
          )}

          {data?.unavailable && (
            <p className="py-10 text-center text-sm text-text-tertiary">
              Não foi possível buscar as picks da IA agora. Tenta de novo em instantes.
            </p>
          )}

          {data && !data.unavailable && data.picks.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <IconTrendingUp size={30} className="text-accent" />
              <p className="max-w-xs text-sm text-text-secondary">
                Nenhuma aposta de valor positivo encontrada no momento, só vai aparecer aqui quando o
                modelo achar uma odd acima do valor justo.
              </p>
            </div>
          )}

          {data && data.picks.length > 0 && (
            <>
              <div className="mb-3 flex items-center gap-1.5 font-mono text-[10px] text-text-tertiary lg:hidden">
                <IconSparkle size={12} className="text-accent" />
                Picks com odd acima do valor justo calculado pela IA, ordenadas por horário do jogo.
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4">
                {data.picks.map((pick) => (
                  <PickCard key={pick.id} pick={pick} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
