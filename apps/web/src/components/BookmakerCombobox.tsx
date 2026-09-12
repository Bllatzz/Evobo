import { useEffect, useRef, useState } from "react";
import { bookmakerLabel } from "../lib/bookmakers";

/** Campo "Casa" — digita e filtra. Duas seções: "Nessa tip" (as casas que a
 * própria mensagem já trazia, cada uma com o link real dela — escolher uma
 * troca bookmaker + betUrl junto) e, depois de uma linha divisória, as
 * demais casas já vistas em outras tips (só troca o rótulo, não existe link
 * pra elas aqui) — ou um nome novo, digitado na hora. Usado tanto no
 * acompanhamento pessoal (VIP Telegram) quanto na edição oficial (Admin). */
export function BookmakerCombobox({
  value,
  options,
  included,
  onChange,
}: {
  value: string | null;
  options: string[];
  included: { bookmaker: string | null; betUrl: string | null }[];
  onChange: (raw: string, betUrl?: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const q = query.trim().toLowerCase();
  const includedNames = new Set(included.map((o) => o.bookmaker).filter((b): b is string => !!b));
  const otherOptions = options.filter((o) => !includedNames.has(o));

  const filteredIncluded = q ? included.filter((o) => o.bookmaker && bookmakerLabel(o.bookmaker).toLowerCase().includes(q)) : included;
  const filteredOther = q ? otherOptions.filter((o) => bookmakerLabel(o).toLowerCase().includes(q)) : otherOptions;
  const exactMatch = options.some((o) => o.toLowerCase() === q) || included.some((o) => o.bookmaker?.toLowerCase() === q);

  function commitIncluded(o: { bookmaker: string | null; betUrl: string | null }) {
    if (!o.bookmaker) return;
    onChange(o.bookmaker, o.betUrl);
    setQuery("");
    setOpen(false);
  }

  function commitFree(raw: string) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) {
      setOpen(false);
      return;
    }
    onChange(normalized);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <input
        value={open ? query : bookmakerLabel(value)}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && q) commitFree(query);
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Digite a casa"
        className="w-full min-w-0 rounded bg-transparent text-[13px] font-bold text-text outline-none placeholder:text-[12px] placeholder:font-normal placeholder:text-text-tertiary"
      />
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-48 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg [scrollbar-width:thin] [scrollbar-color:var(--color-border-strong)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-strong [&::-webkit-scrollbar-track]:bg-transparent">
          {filteredIncluded.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-1.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">NESSA TIP</div>
              {filteredIncluded.map((o) => (
                <button
                  key={o.bookmaker}
                  type="button"
                  onClick={() => commitIncluded(o)}
                  className="block w-full truncate rounded-lg px-3 py-1.5 text-left text-[13px] font-semibold text-accent hover:bg-surface-alt"
                >
                  {bookmakerLabel(o.bookmaker)}
                </button>
              ))}
              {filteredOther.length > 0 && <div className="my-1 border-t border-border-subtle" />}
            </>
          )}
          {filteredOther.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => commitFree(o)}
              className="block w-full truncate rounded-lg px-3 py-1.5 text-left text-[13px] text-text-secondary hover:bg-surface-alt"
            >
              {bookmakerLabel(o)}
            </button>
          ))}
          {q && !exactMatch && (
            <button
              type="button"
              onClick={() => commitFree(query)}
              className="block w-full truncate rounded-lg px-3 py-1.5 text-left text-[13px] font-semibold text-accent"
            >
              Usar "{query.trim()}"
            </button>
          )}
          {filteredIncluded.length === 0 && filteredOther.length === 0 && !q && (
            <p className="px-3 py-1.5 text-[12px] text-text-tertiary">Nenhuma casa cadastrada ainda.</p>
          )}
        </div>
      )}
    </div>
  );
}
