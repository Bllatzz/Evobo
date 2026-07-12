import { useEffect, useMemo, useState } from "react";
import type { Game } from "@evobo/shared-types";
import { fetchGames } from "../../lib/tips";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildDateStrip() {
  const days = [];
  for (let offset = -1; offset <= 3; offset++) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    days.push({
      date: isoDate(d),
      label: offset === 0 ? "HOJE" : d.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3).toUpperCase(),
      day: d.getDate(),
    });
  }
  return days;
}

export function GamesPage() {
  const dateStrip = useMemo(buildDateStrip, []);
  const [selectedDate, setSelectedDate] = useState(dateStrip[1]!.date); // "hoje"
  const [games, setGames] = useState<Game[] | null>(null);

  useEffect(() => {
    fetchGames({ date: selectedDate }).then(setGames);
  }, [selectedDate]);

  const grouped = useMemo(() => {
    if (!games) return [];
    const map = new Map<string, Game[]>();
    for (const g of games) {
      const list = map.get(g.league) ?? [];
      list.push(g);
      map.set(g.league, list);
    }
    return [...map.entries()];
  }, [games]);

  return (
    <div className="pb-6 lg:px-6 lg:pb-10 lg:pt-2">
      <div className="flex items-center justify-between px-5 pb-3 pt-3 lg:px-0 lg:pb-5">
        <span className="text-[20px] font-bold tracking-[-0.02em] lg:text-[22px]">Jogos</span>
      </div>

      <div className="flex gap-1.5 overflow-x-auto px-5 pb-3.5 font-mono lg:px-0 lg:pb-6">
        {dateStrip.map((d) => (
          <button
            key={d.date}
            onClick={() => setSelectedDate(d.date)}
            className={`flex-none rounded-[10px] px-3 py-1 text-center ${
              selectedDate === d.date ? "bg-accent text-[#08090A]" : "text-text-tertiary"
            }`}
          >
            <div className="text-[10px]">{d.label}</div>
            <div className="text-[14px] font-semibold">{d.day}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 px-4 lg:grid lg:grid-cols-2 lg:gap-5 lg:px-0">
        {games === null && (
          <p className="py-10 text-center text-sm text-text-tertiary lg:col-span-2">Carregando…</p>
        )}
        {games?.length === 0 && (
          <p className="py-10 text-center text-sm text-text-tertiary lg:col-span-2">
            Nenhum jogo neste dia.
          </p>
        )}
        {grouped.map(([league, leagueGames]) => (
          <div key={league}>
            <div className="mb-2 px-1 font-mono text-[12px] font-semibold text-text-secondary">
              {league.toUpperCase()}
            </div>
            <div className="overflow-hidden rounded-2xl border border-border">
              {leagueGames.map((game, i) => (
                <div
                  key={game.id}
                  className={`flex items-center gap-3 bg-surface p-3.5 ${
                    i > 0 ? "border-t border-border-subtle" : ""
                  }`}
                >
                  <div className="w-[42px] flex-none text-center font-mono text-[11px]">
                    {game.status === "live" ? (
                      <span className="text-live">AO VIVO</span>
                    ) : (
                      <span className="text-text-tertiary">
                        {new Date(game.startsAt).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 border-l border-border pl-3">
                    <div className="mb-1.5 flex justify-between">
                      <span className="text-[14px]">{game.homeTeam}</span>
                      <span className="font-mono text-[14px] font-bold">{game.scoreHome ?? ""}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[14px]">{game.awayTeam}</span>
                      <span className="font-mono text-[14px] font-bold">{game.scoreAway ?? ""}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
