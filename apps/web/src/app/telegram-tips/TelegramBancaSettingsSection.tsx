import { useEffect, useState } from "react";
import {
  fetchTelegramSettings,
  saveTelegramSettings,
  fetchBookmakerBalances,
  saveBookmakerBalances,
  type TelegramBookmakerBalance,
} from "../../lib/telegramTips";
import { IconTelegram, IconPlus, IconX } from "../../components/Icon";

/** "Unidade & Saldos" — bankroll management for the Banca Telegram feature.
 * Only rendered for users with the telegram_banca screen (see MyProfilePage). */
export function TelegramBancaSettingsSection() {
  const [unitValue, setUnitValue] = useState<string>("");
  const [balances, setBalances] = useState<TelegramBookmakerBalance[]>([]);
  const [newBookmaker, setNewBookmaker] = useState("");
  const [newBalance, setNewBalance] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchTelegramSettings().then((s) => setUnitValue(s.unitValue != null ? String(s.unitValue) : ""));
    fetchBookmakerBalances().then(setBalances);
  }, []);

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
    if (!newBookmaker.trim() || newBalance.trim() === "") return;
    const next = [...balances, { bookmaker: newBookmaker.trim(), balance: Number(newBalance.replace(",", ".")) }];
    setNewBookmaker("");
    setNewBalance("");
    void persistBalances(next);
  }

  function removeBalance(bookmaker: string) {
    void persistBalances(balances.filter((b) => b.bookmaker !== bookmaker));
  }

  return (
    <div className="mb-6 rounded-2xl border border-border bg-surface p-4.5">
      <div className="mb-3.5 flex items-center gap-2">
        <IconTelegram size={16} className="text-accent" />
        <span className="text-[14px] font-bold">Unidade & Saldos · VIP Telegram</span>
      </div>

      <div className="mb-4 flex items-end gap-2">
        <div className="flex-1">
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
        {saving && <span className="pb-2 text-[11px] text-text-tertiary">salvando…</span>}
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
        <input
          value={newBookmaker}
          onChange={(e) => setNewBookmaker(e.target.value)}
          placeholder="Casa (ex.: bet365)"
          className="min-w-0 flex-1 rounded-[10px] border border-border-strong bg-surface-chip px-3 py-2 text-[13px]"
        />
        <input
          value={newBalance}
          onChange={(e) => setNewBalance(e.target.value)}
          inputMode="decimal"
          placeholder="Saldo"
          className="w-28 flex-none rounded-[10px] border border-border-strong bg-surface-chip px-3 py-2 text-[13px]"
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
  );
}
