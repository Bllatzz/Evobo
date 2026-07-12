import { useEffect, useState } from "react";
import type { Game } from "@evobo/shared-types";
import { fetchGames } from "../../lib/tips";

const sports = ["Todos", "Futebol", "Basquete", "Favoritos"];

export function LivePage() {
  const [games, setGames] = useState<Game[] | null>(null);
  const [selectedSport, setSelectedSport] = useState(sports[0]);

  useEffect(() => {
    fetchGames({ status: "live" }).then(setGames);
    const interval = setInterval(() => fetchGames({ status: "live" }).then(setGames), 15_000);
    return () => clearInterval(interval);
  }, []);

  // Only football is tracked by the backend today (Game has no `sport` field) —
  // other chips are real tabs, just honestly empty until that data exists.
  const visibleGames = selectedSport === "Todos" || selectedSport === "Futebol" ? games : [];

  return (
    <div className="pb-6 lg:px-3 lg:pt-2">
      <div className="flex items-center gap-2 px-5 pb-3 pt-3">
        <span className="h-2 w-2 animate-pulse rounded-full bg-live" />
        <span className="text-[20px] font-bold tracking-[-0.02em]">Ao Vivo</span>
      </div>

      <div className="flex gap-2 overflow-x-auto px-5 pb-3.5">
        {sports.map((sport) => (
          <button
            key={sport}
            onClick={() => setSelectedSport(sport)}
            className={`flex-none rounded-[11px] px-4 py-2 text-[13px] font-medium ${
              selectedSport === sport ? "bg-accent text-[#08090A]" : "bg-surface-alt text-text-secondary"
            }`}
          >
            {sport === "Todos" ? `Todos · ${games?.length ?? 0}` : sport}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5 px-4 lg:grid lg:grid-cols-3 lg:gap-4 lg:px-2">
        {games === null && <p className="py-10 text-center text-sm text-text-tertiary lg:col-span-3">Carregando…</p>}
        {games !== null && visibleGames?.length === 0 && (
          <p className="py-10 text-center text-sm text-text-tertiary lg:col-span-3">
            {selectedSport === "Todos" || selectedSport === "Futebol"
              ? "Nenhum jogo ao vivo no momento."
              : `Ainda não cobrimos ${selectedSport.toLowerCase()} ao vivo.`}
          </p>
        )}
        {visibleGames?.map((game) => {
          const homeLeads = (game.scoreHome ?? 0) > (game.scoreAway ?? 0);
          const awayLeads = (game.scoreAway ?? 0) > (game.scoreHome ?? 0);
          return (
            <div key={game.id} className="rounded-[18px] border border-border bg-surface p-4">
              <div className="mb-3.5 flex items-center justify-between">
                <span className="font-mono text-[10px] text-text-tertiary">
                  {game.league.toUpperCase()}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-live">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
                  AO VIVO
                </span>
              </div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[15px] font-semibold">{game.homeTeam}</span>
                <span className={`font-mono text-[20px] font-bold ${homeLeads ? "text-accent" : "text-text"}`}>
                  {game.scoreHome ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold">{game.awayTeam}</span>
                <span className={`font-mono text-[20px] font-bold ${awayLeads ? "text-accent" : "text-text"}`}>
                  {game.scoreAway ?? 0}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
