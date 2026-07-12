import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "@evobo/shared-types";
import { createTip, fetchGames } from "../../lib/tips";
import { IconLock, IconX } from "../../components/Icon";

export function NewTipPage() {
  const navigate = useNavigate();

  const [gameQuery, setGameQuery] = useState("");
  const [gameResults, setGameResults] = useState<Game[]>([]);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  const [market, setMarket] = useState("");
  const [odds, setOdds] = useState("");
  const [stake, setStake] = useState("1");
  const [betLink, setBetLink] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGameSearch(value: string) {
    setGameQuery(value);
    setSelectedGame(null);
    if (value.trim().length < 2) {
      setGameResults([]);
      return;
    }
    setGameResults(await fetchGames({ q: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedGame || !market.trim() || !odds || !stake || !betLink.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const tip = await createTip({
        matchId: selectedGame.id,
        market: market.trim(),
        odds: Number(odds),
        stakeUnits: Number(stake),
        house: betLink.trim(),
        analysisText: analysis.trim() || undefined,
        visibility: "public",
      });
      navigate(`/tip/${tip.id}`, { replace: true });
    } catch {
      setError("Não foi possível publicar a tip. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  const canPublish =
    !!selectedGame && !!market.trim() && !!odds && !!stake && !!betLink.trim() && !submitting;

  return (
    <div className="min-h-dvh bg-bg pb-8 text-text">
      <form onSubmit={handleSubmit}>
        <div className="flex items-center gap-3.5 border-b border-border px-4 pb-3 pt-14 lg:hidden">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Fechar"
          >
            <IconX size={20} />
          </button>
          <span className="text-[16px] font-semibold">Nova Tip</span>
          <button
            type="submit"
            disabled={!canPublish}
            className="ml-auto rounded-[10px] bg-accent px-4 py-2 text-[13px] font-bold text-[#08090A] disabled:opacity-40"
          >
            Publicar
          </button>
        </div>

        <div className="hidden items-center gap-3.5 border-b border-border px-8 py-[18px] lg:flex">
          <span className="text-[22px] font-bold tracking-[-0.02em]">Nova Tip</span>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="ml-auto text-[13px] font-semibold text-text-secondary"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canPublish}
            className="rounded-[11px] bg-accent px-5 py-2.5 text-[13px] font-bold text-[#08090A] disabled:opacity-40"
          >
            Publicar
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4 lg:mx-auto lg:max-w-[640px] lg:rounded-2xl lg:border lg:border-border lg:bg-surface lg:p-8 lg:mt-8">
          <div>
            <div className="mb-2 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
              JOGO
            </div>
            {selectedGame ? (
              <div className="flex items-center justify-between rounded-xl border border-accent-border bg-surface p-3.5">
                <span className="text-[14px] font-semibold">
                  {selectedGame.homeTeam} x {selectedGame.awayTeam}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedGame(null)}
                  className="text-[12px] text-text-tertiary"
                >
                  trocar
                </button>
              </div>
            ) : (
              <>
                <input
                  value={gameQuery}
                  onChange={(e) => handleGameSearch(e.target.value)}
                  placeholder="Buscar partida…"
                  className="w-full rounded-xl border border-border-strong bg-surface px-3.5 py-3.5 text-[14px] text-text outline-none focus:border-accent"
                />
                {gameResults.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {gameResults.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          setSelectedGame(g);
                          setGameResults([]);
                        }}
                        className="rounded-lg bg-surface-alt px-3 py-2.5 text-left text-[13.5px]"
                      >
                        {g.homeTeam} x {g.awayTeam}{" "}
                        <span className="text-text-tertiary">· {g.league}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex gap-2.5">
            <div className="flex-1">
              <div className="mb-2 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
                MERCADO
              </div>
              <input
                value={market}
                onChange={(e) => setMarket(e.target.value)}
                placeholder="Ex.: Ambas marcam — Sim"
                className="w-full rounded-xl border border-border-strong bg-surface px-3.5 py-3.5 text-[14px] text-text outline-none focus:border-accent"
              />
            </div>
            <div className="w-[110px]">
              <div className="mb-2 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
                ODD
              </div>
              <input
                type="number"
                step="0.01"
                min="1.01"
                value={odds}
                onChange={(e) => setOdds(e.target.value)}
                placeholder="1.85"
                className="w-full rounded-xl border border-border-strong bg-surface px-3.5 py-3.5 font-mono text-[14px] text-text outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <div className="mb-2 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
              STAKE (UNIDADES)
            </div>
            <div className="relative">
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="10"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                placeholder="1"
                className="w-full rounded-xl border border-border-strong bg-surface px-3.5 py-3.5 pr-10 font-mono text-[14px] text-text outline-none focus:border-accent"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center font-mono text-[13px] text-text-tertiary">
                u
              </span>
            </div>
          </div>

          <div>
            <div className="mb-2 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
              LINK DA APOSTA
            </div>
            <input
              type="url"
              value={betLink}
              onChange={(e) => setBetLink(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-xl border border-border-strong bg-surface px-3.5 py-3.5 text-[14px] text-text outline-none focus:border-accent"
            />
          </div>

          <div>
            <div className="mb-2 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
              ANÁLISE (OPCIONAL)
            </div>
            <textarea
              value={analysis}
              onChange={(e) => setAnalysis(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Jogo aberto, ambos precisam vencer…"
              className="w-full resize-none rounded-xl border border-border-strong bg-surface px-3.5 py-3.5 text-[14px] text-text outline-none focus:border-accent"
            />
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border-strong bg-surface-alt px-3.5 py-3.5 opacity-60">
            <IconLock size={18} />
            <div className="flex-1">
              <div className="text-[14px] font-semibold">Postar no grupo VIP</div>
              <div className="text-[12px] text-text-tertiary">
                Disponível assim que você criar um grupo VIP
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-live">{error}</p>}
        </div>
      </form>
    </div>
  );
}
