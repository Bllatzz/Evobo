import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { search, type SearchResults } from "../../lib/search";
import { formatOdds } from "../../lib/format";
import { Avatar } from "../../components/Avatar";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { IconSearch } from "../../components/Icon";

const categories = ["Tudo", "Tipsters", "Jogos", "Esportes"] as const;

function TipsterRow({ t }: { t: SearchResults["tipsters"][number] }) {
  return (
    <Link key={t.id} to={`/u/${t.username}`} className="flex items-center gap-3 rounded-xl py-2">
      <Avatar name={t.displayName} seed={t.id} src={t.avatarUrl} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[14px] font-semibold">
          {t.displayName}
          {t.verifiedAt && <VerifiedBadge size={12} />}
        </div>
        <div className="font-mono text-[11px] text-text-tertiary">
          @{t.username} · {t.followers} seguidores
        </div>
      </div>
    </Link>
  );
}

function GameRow({ g }: { g: SearchResults["games"][number] }) {
  return (
    <div key={g.id} className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">
          {g.homeTeam} x {g.awayTeam}
        </div>
        <div className="font-mono text-[11px] text-text-tertiary">
          {g.league} {g.status === "live" && <span className="text-live">· AO VIVO</span>}
        </div>
      </div>
    </div>
  );
}

function TipCardRow({ t }: { t: SearchResults["tips"][number] }) {
  return (
    <Link
      key={t.id}
      to={`/tip/${t.id}`}
      className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3"
    >
      <Avatar name={t.author.displayName} seed={t.author.id} src={t.author.avatarUrl} size={40} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">
          {t.match.homeTeam} x {t.match.awayTeam}
        </div>
        <div className="font-mono text-[12.5px] text-text-tertiary">
          {t.author.displayName} · {t.market}
        </div>
      </div>
      <div className="font-mono text-[15px] font-bold text-accent">{formatOdds(t.odds)}</div>
    </Link>
  );
}

export function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("Tudo");
  const [results, setResults] = useState<SearchResults | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const timeout = setTimeout(() => search(query.trim()).then(setResults), 250);
    return () => clearTimeout(timeout);
  }, [query]);

  const showTipsters = category === "Tudo" || category === "Tipsters";
  const showGames = category === "Tudo" || category === "Jogos";
  const nothingFound =
    results !== null &&
    results.tipsters.length === 0 &&
    results.games.length === 0 &&
    results.tips.length === 0;

  return (
    <div className="min-h-dvh bg-bg text-text">
      {/* Mobile — a pushed full-screen search modal (back button, no sidebar). */}
      <div className="lg:hidden">
        <div className="flex items-center gap-3 px-4 pb-4 pt-14">
          <button onClick={() => navigate(-1)} className="text-2xl leading-none" aria-label="Voltar">
            ‹
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-accent-border bg-surface-alt px-3.5 py-2.5">
            <IconSearch size={18} className="text-text-tertiary" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar tips, times, tipsters…"
              className="w-full bg-transparent text-[14px] text-text outline-none placeholder:text-text-tertiary"
            />
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto px-4 pb-3">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`flex-none rounded-[10px] px-3.5 py-1.5 text-[12px] font-semibold ${
                category === c ? "bg-accent text-[#08090A]" : "bg-surface-alt text-text-secondary"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {results && (
          <div className="flex flex-col gap-4 px-4">
            {showTipsters && results.tipsters.length > 0 && (
              <div>
                <div className="mb-2 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
                  TIPSTERS
                </div>
                <div className="flex flex-col gap-1">
                  {results.tipsters.map((t) => (
                    <TipsterRow key={t.id} t={t} />
                  ))}
                </div>
              </div>
            )}

            {showGames && results.games.length > 0 && (
              <div>
                <div className="mb-2 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">JOGOS</div>
                <div className="flex flex-col gap-1.5">
                  {results.games.map((g) => (
                    <GameRow key={g.id} g={g} />
                  ))}
                </div>
              </div>
            )}

            {results.tips.length > 0 && (
              <div>
                <div className="mb-2 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
                  {results.tips.length} TIPS ENCONTRADAS
                </div>
                <div className="flex flex-col gap-1.5">
                  {results.tips.map((t) => (
                    <TipCardRow key={t.id} t={t} />
                  ))}
                </div>
              </div>
            )}

            {nothingFound && (
              <p className="py-10 text-center text-sm text-text-tertiary">Nada encontrado.</p>
            )}
          </div>
        )}
      </div>

      {/* Desktop — sidebar stays visible; search bar + filters share a header
          row, results split into a tips grid with a tipsters/jogos rail. */}
      <div className="hidden lg:block lg:px-8 lg:py-6">
        <span className="text-[22px] font-bold tracking-[-0.02em]">Buscar</span>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-accent-border bg-surface-alt px-4 py-3">
          <IconSearch size={18} className="text-text-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar tips, times, tipsters…"
            className="w-full bg-transparent text-[15px] text-text outline-none placeholder:text-text-tertiary"
          />
        </div>

        <div className="mt-3 flex gap-2">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-[10px] px-3.5 py-1.5 text-[12px] font-semibold ${
                category === c ? "bg-accent text-[#08090A]" : "bg-surface-alt text-text-secondary"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {results && (
          <div className="mt-6 flex gap-8">
            <div className="min-w-0 flex-1">
              <div className="mb-3 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
                {results.tips.length} TIPS ENCONTRADAS
              </div>
              {results.tips.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {results.tips.map((t) => (
                    <TipCardRow key={t.id} t={t} />
                  ))}
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-text-tertiary">
                  Nenhuma tip encontrada.
                </p>
              )}
            </div>

            <div className="flex w-[300px] flex-none flex-col gap-5">
              {showTipsters && (
                <div className="rounded-2xl border border-border bg-surface p-4">
                  <div className="mb-2 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
                    TIPSTERS
                  </div>
                  {results.tipsters.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {results.tipsters.map((t) => (
                        <TipsterRow key={t.id} t={t} />
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-[12px] text-text-tertiary">Nada encontrado.</p>
                  )}
                </div>
              )}

              {showGames && (
                <div className="rounded-2xl border border-border bg-surface p-4">
                  <div className="mb-2 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
                    JOGOS
                  </div>
                  {results.games.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {results.games.map((g) => (
                        <GameRow key={g.id} g={g} />
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-[12px] text-text-tertiary">Nada encontrado.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!results && (
          <p className="py-16 text-center text-sm text-text-tertiary">
            Digite pelo menos 2 caracteres para buscar.
          </p>
        )}
      </div>
    </div>
  );
}
