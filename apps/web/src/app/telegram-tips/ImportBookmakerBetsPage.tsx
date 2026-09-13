import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchBookmakerNames,
  importBookmakerBets,
  type ImportBookmakerBetsResult,
} from "../../lib/telegramTips";
import { bookmakerLabel } from "../../lib/bookmakers";
import { Dropdown } from "../../components/Dropdown";
import { IconTelegram, IconChevronLeft } from "../../components/Icon";

function formatUnit(v: number | null): string {
  return v !== null ? `${v}u` : "—";
}

/**
 * Cola o JSON extraído pelo script de scraping (rodado pelo próprio usuário
 * no navegador, na tela de histórico de apostas da casa — ver
 * scripts/bookmaker-scrapers/) e casa contra as tips ainda não decididas.
 *
 * PILOTO: só roda em modo "conferir" (dry run) — nunca grava nada ainda.
 * Cada match mostra lado a lado o que já está salvo hoje vs o que o import
 * calcularia, pra validar contra uma casa já 100% conferida manualmente
 * antes de ligar a gravação de verdade numa versão futura desta tela.
 */
export function ImportBookmakerBetsPage() {
  const [bookmakers, setBookmakers] = useState<string[]>([]);
  const [bookmaker, setBookmaker] = useState("");
  const [raw, setRaw] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportBookmakerBetsResult | null>(null);

  useEffect(() => {
    fetchBookmakerNames().then(setBookmakers).catch(() => {});
  }, []);

  async function handleCheck() {
    setError(null);
    setResult(null);
    if (!bookmaker) {
      setError("Escolha a casa primeiro.");
      return;
    }
    let bets;
    try {
      bets = JSON.parse(raw);
      if (!Array.isArray(bets)) throw new Error();
    } catch {
      setError("JSON inválido — cole exatamente o que o script gerou.");
      return;
    }
    setRunning(true);
    try {
      const res = await importBookmakerBets(bookmaker, bets, true);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao conferir.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl pb-10 lg:pt-6">
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-3 lg:px-0">
        <Link to="/telegram-tips" aria-label="Voltar" className="hidden flex-none items-center justify-center text-text-secondary lg:flex">
          <IconChevronLeft size={20} />
        </Link>
        <IconTelegram size={22} className="text-accent" />
        <span className="text-[20px] font-bold tracking-[-0.02em] lg:text-[22px]">Importar apostas · VIP Telegram</span>
      </div>

      <div className="mx-5 rounded-2xl border border-border bg-surface p-4 lg:mx-0">
        <p className="mb-3 text-[12.5px] text-text-tertiary">
          Modo piloto: isso só CONFERE, nunca grava nada ainda. Cole o JSON gerado pelo script de scraping (rodado no seu
          próprio navegador, já logado na casa) e veja o que teria sido marcado.
        </p>

        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] font-semibold text-text-secondary">Casa</span>
          <Dropdown
            value={bookmaker}
            onChange={setBookmaker}
            placeholder="Escolha a casa"
            options={bookmakers.map((b) => ({ value: b, label: bookmakerLabel(b) }))}
            className="w-full"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] font-semibold text-text-secondary">JSON do script</span>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder='[{"betNumber": "...", "status": "ganha", ...}]'
            rows={8}
            className="w-full rounded-lg border border-border-strong bg-surface-alt px-3 py-2 font-mono text-[12px] text-text outline-none"
          />
        </label>

        <button
          onClick={handleCheck}
          disabled={running}
          className="w-full rounded-lg bg-accent py-2.5 text-[13px] font-bold text-[#08090A] disabled:opacity-50"
        >
          {running ? "Conferindo…" : "Conferir"}
        </button>
        {error && <p className="mt-2 text-[12.5px] text-live">{error}</p>}
      </div>

      {result && (
        <div className="mx-5 mt-4 flex flex-col gap-4 lg:mx-0">
          <p className="text-[12.5px] text-text-tertiary">
            {result.matched.length} bateram · {result.ambiguous.length} ambíguas · {result.unmatched.length} sem match
            {result.dryRun ? " — nada foi gravado (dry run)." : ""}
          </p>

          {result.matched.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface">
              <div className="border-b border-border-subtle px-4 py-2.5 text-[13px] font-bold">Bateram</div>
              {result.matched.map((m) => (
                <div key={m.tipId} className="border-b border-border-subtle px-4 py-3 last:border-b-0">
                  <p className="text-[13px] font-semibold">{m.match ?? "—"}</p>
                  <p className="mb-1.5 truncate text-[12px] text-text-tertiary">{m.selection ?? "—"}</p>
                  <div className="grid grid-cols-2 gap-2 text-[12px]">
                    <div className="rounded-lg bg-surface-chip p-2">
                      <p className="text-text-tertiary">Hoje</p>
                      <p className="font-mono">
                        {formatUnit(m.current?.unit ?? null)} · odd {m.current?.odd ?? "—"} · {m.current?.result ?? "—"}
                      </p>
                    </div>
                    <div className="rounded-lg bg-accent-soft p-2 text-accent">
                      <p className="text-text-tertiary">Import calcularia</p>
                      <p className="font-mono">
                        {formatUnit(m.unit)} · odd {m.odd} · {m.result ?? "(sem mudança)"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {result.ambiguous.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface">
              <div className="border-b border-border-subtle px-4 py-2.5 text-[13px] font-bold">
                Ambíguas (configure o "valor da unidade" na Banca pra desempatar)
              </div>
              {result.ambiguous.map((a, i) => (
                <div key={i} className="border-b border-border-subtle px-4 py-3 last:border-b-0">
                  <p className="mb-1.5 text-[13px] font-semibold">
                    {a.bet.game ?? "—"} · odd {a.bet.odd} · R$ {a.bet.stakeReais.toFixed(2)}
                  </p>
                  <ul className="space-y-1 text-[12px] text-text-tertiary">
                    {a.candidates.map((c) => (
                      <li key={c.tipId}>
                        {c.match ?? "—"} — {c.selection || "—"} ({formatUnit(c.unit)})
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {result.unmatched.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface">
              <div className="border-b border-border-subtle px-4 py-2.5 text-[13px] font-bold">Sem match</div>
              {result.unmatched.map((b, i) => (
                <div key={i} className="border-b border-border-subtle px-4 py-2.5 text-[12.5px] text-text-tertiary last:border-b-0">
                  {b.game ?? "—"} · {b.selection} · odd {b.odd}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
