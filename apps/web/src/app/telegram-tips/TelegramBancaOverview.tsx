import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchTelegramSettings,
  saveTelegramSettings,
  fetchBookmakerBalances,
  saveBookmakerBalances,
  fetchBookmakerNames,
  fetchTelegramBanca,
  fetchTelegramTips,
  type TelegramBookmakerBalance,
  type TelegramTip,
} from "../../lib/telegramTips";
import { IconPlus, IconX } from "../../components/Icon";

const OTHER_OPTION = "__outra__";

const resultLabel: Record<string, { text: string; className: string }> = {
  green: { text: "Green", className: "text-accent" },
  red: { text: "Red", className: "text-live" },
  reembolso: { text: "Reembolso", className: "text-text-tertiary" },
  pending: { text: "Em aberto", className: "text-text-tertiary" },
};

/** "VIP Telegram" — a own row of the profile: live Banca Inicial/Atual/Winrate/ROI
 * tiles (same visual weight as the public feed stats above), then unit/saldo
 * settings and the tips the user has actually taken, side by side — same
 * rhythm as "Evolução da banca" + "Tips recentes". Only rendered for users
 * with the telegram_banca screen (see MyProfilePage). */
export function TelegramBancaOverview() {
  const [unitValue, setUnitValue] = useState<string>("");
  const [balances, setBalances] = useState<TelegramBookmakerBalance[]>([]);
  const [bookmakerNames, setBookmakerNames] = useState<string[]>([]);
  const [newBookmaker, setNewBookmaker] = useState("");
  const [customBookmaker, setCustomBookmaker] = useState("");
  const [newBalance, setNewBalance] = useState("");
  const [saving, setSaving] = useState(false);
  const [takenProfitUnits, setTakenProfitUnits] = useState<number | null>(null);
  const [greenPct, setGreenPct] = useState<number | null>(null);
  const [roiPct, setRoiPct] = useState<number | null>(null);
  const [takenTips, setTakenTips] = useState<TelegramTip[] | null>(null);

  useEffect(() => {
    fetchTelegramSettings().then((s) => setUnitValue(s.unitValue != null ? String(s.unitValue) : ""));
    fetchBookmakerBalances().then(setBalances);
    fetchBookmakerNames().then(setBookmakerNames);
    fetchTelegramBanca().then((b) => {
      setTakenProfitUnits(b.totals.peguei?.profit ?? 0);
      setGreenPct(b.totals.peguei?.greenPct ?? null);
      setRoiPct(b.totals.peguei?.roiPct ?? null);
    });
    fetchTelegramTips({ takenStatus: "taken", limit: 6 })
      .then((res) => setTakenTips(res.data))
      .catch(() => setTakenTips([]));
  }, []);

  const availableBookmakers = useMemo(
    () => bookmakerNames.filter((name) => !balances.some((b) => b.bookmaker === name)),
    [bookmakerNames, balances],
  );

  const unitValueNum = Number(unitValue.replace(",", "."));
  const depositedTotal = balances.reduce((sum, b) => sum + b.balance, 0);
  const bancaInicialUnits = unitValueNum > 0 ? depositedTotal / unitValueNum : null;
  const bancaAtualUnits =
    bancaInicialUnits !== null && takenProfitUnits !== null ? bancaInicialUnits + takenProfitUnits : null;
  const positive = bancaAtualUnits === null || bancaInicialUnits === null || bancaAtualUnits >= bancaInicialUnits;

  async function saveUnitValue() {
    const value = unitValue.trim() === "" ? null : Number(unitValue.replace(",", "."));
    if (value !== null && (Number.isNaN(value) || value <= 0)) return;
    setSaving(true);
    try {
      const saved = await saveTelegramSettings({ unitValue: value });
      setUnitValue(saved.unitValue != null ? String(saved.unitValue) : "");
    } finally {
      setSaving(false);
    }
  }

  async function persistBalances(next: TelegramBookmakerBalance[]) {
    setBalances(next);
    await saveBookmakerBalances(next);
  }

  function addBalance() {
    const bookmaker = (newBookmaker === OTHER_OPTION ? customBookmaker : newBookmaker).trim();
    if (!bookmaker || newBalance.trim() === "") return;
    const next = [...balances, { bookmaker, balance: Number(newBalance.replace(",", ".")) }];
    setNewBookmaker("");
    setCustomBookmaker("");
    setNewBalance("");
    void persistBalances(next);
  }

  function removeBalance(bookmaker: string) {
    void persistBalances(balances.filter((b) => b.bookmaker !== bookmaker));
  }

  return (
    <div className="mt-8">
      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="rounded-2xl border border-border bg-surface p-4.5">
          <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">BANCA INICIAL</div>
          <div className="font-mono text-[26px] font-bold">{bancaInicialUnits !== null ? `${bancaInicialUnits.toFixed(1)}u` : "—"}</div>
        </div>
        <div className={`rounded-2xl border p-4.5 ${positive ? "border-accent-border bg-accent-soft" : "border-live/30 bg-live/10"}`}>
          <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">BANCA ATUAL</div>
          <div className={`font-mono text-[26px] font-bold ${positive ? "text-accent" : "text-live"}`}>
            {bancaAtualUnits !== null ? `${bancaAtualUnits.toFixed(1)}u` : "—"}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4.5">
          <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">WINRATE</div>
          <div className="font-mono text-[26px] font-bold">{greenPct != null ? `${greenPct}%` : "—"}</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4.5">
          <div className="mb-2.5 font-mono text-[10px] tracking-[0.05em] text-text-tertiary">ROI</div>
          <div className={`font-mono text-[26px] font-bold ${roiPct == null ? "" : roiPct >= 0 ? "text-accent" : "text-live"}`}>
            {roiPct != null ? `${roiPct >= 0 ? "+" : ""}${roiPct}%` : "—"}
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        <div className="min-w-0 flex-1 rounded-2xl border border-border bg-surface p-[22px]">
          <div className="mb-5 flex items-center justify-between">
            <span className="text-[14px] font-bold">Unidade & saldos</span>
            {saving && <span className="text-[11px] text-text-tertiary">salvando…</span>}
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-[11px] text-text-tertiary">Valor da unidade (R$)</label>
            <input
              value={unitValue}
              onChange={(e) => setUnitValue(e.target.value)}
              onBlur={saveUnitValue}
              inputMode="decimal"
              placeholder="Ex.: 50"
              className="w-full rounded-[10px] border border-border-strong bg-surface-chip px-3 py-2 text-[13px]"
            />
          </div>

          <div className="mb-2 text-[11px] text-text-tertiary">Saldo por casa de aposta</div>
          <div className="mb-3 flex flex-col gap-2">
            {balances.map((b) => (
              <div key={b.bookmaker} className="flex items-center justify-between rounded-[10px] border border-border-subtle bg-surface-chip px-3 py-2">
                <span className="truncate text-[13px] font-semibold capitalize">{b.bookmaker}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px]">{b.balance.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
                  <button onClick={() => removeBalance(b.bookmaker)} aria-label="Remover" className="text-text-tertiary">
                    <IconX size={13} />
                  </button>
                </div>
              </div>
            ))}
            {balances.length === 0 && <p className="text-[12px] text-text-tertiary">Nenhuma casa cadastrada ainda.</p>}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={newBookmaker}
              onChange={(e) => setNewBookmaker(e.target.value)}
              className="min-w-0 flex-1 rounded-[10px] border border-border-strong bg-surface-chip px-3 py-2 text-[13px] capitalize"
            >
              <option value="" disabled>
                Escolha a casa
              </option>
              {availableBookmakers.map((name) => (
                <option key={name} value={name} className="capitalize">
                  {name}
                </option>
              ))}
              <option value={OTHER_OPTION}>+ Outra casa…</option>
            </select>
            {newBookmaker === OTHER_OPTION && (
              <input
                value={customBookmaker}
                onChange={(e) => setCustomBookmaker(e.target.value)}
                placeholder="Nome da casa"
                className="min-w-0 flex-1 rounded-[10px] border border-border-strong bg-surface-chip px-3 py-2 text-[13px]"
              />
            )}
            <input
              value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
              inputMode="decimal"
              placeholder="Saldo"
              className="w-24 flex-none rounded-[10px] border border-border-strong bg-surface-chip px-3 py-2 text-[13px]"
            />
            <button
              onClick={addBalance}
              className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-accent text-[#08090A]"
              aria-label="Adicionar casa"
            >
              <IconPlus size={16} />
            </button>
          </div>
        </div>

        <div className="w-[320px] flex-none rounded-2xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-mono text-[11px] tracking-[0.06em] text-text-tertiary">TIPS QUE PEGUEI</span>
            <Link to="/telegram-tips" className="font-mono text-[11px] text-accent">
              ver todas
            </Link>
          </div>
          <div className="flex flex-col">
            {(takenTips ?? []).map((tip) => {
              const label = resultLabel[tip.result] ?? resultLabel.pending!;
              return (
                <div key={tip.id} className="flex items-center justify-between gap-2 border-b border-border-subtle py-3 last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">{tip.match ?? tip.groupName}</div>
                    <div className="truncate font-mono text-[11px] text-text-tertiary">
                      {tip.unit != null ? `${tip.unit}u` : "—"} · {tip.bookmaker ?? "—"}
                    </div>
                  </div>
                  <span className={`flex-none rounded-lg border px-2 py-1 font-mono text-[10px] font-bold ${label.className} border-current/40`}>
                    {label.text.toUpperCase()}
                  </span>
                </div>
              );
            })}
            {takenTips?.length === 0 && (
              <p className="py-4 text-center text-[12px] text-text-tertiary">
                Nenhuma tip pega ainda —{" "}
                <Link to="/telegram-tips" className="font-semibold text-accent">
                  marca uma aqui
                </Link>
                .
              </p>
            )}
            {takenTips === null && <p className="py-4 text-center text-[12px] text-text-tertiary">Carregando…</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
