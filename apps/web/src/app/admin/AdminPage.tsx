import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  fetchAdminOverview,
  fetchRobotMarketOdds,
  updateRobotMarketOdd,
  type AdminOverview,
  type RobotMarketOddEntry,
} from "../../lib/admin";
import {
  rebuildTelegramTips,
  fetchBookmakerNames,
  fetchTelegramSettings,
  saveTelegramSettings,
  type TelegramBancaSettings,
} from "../../lib/telegramTips";
import { bookmakerLabel } from "../../lib/bookmakers";
import {
  IconChevronLeft,
  IconCheck,
  IconShield,
  IconSparkle,
  IconProfile,
  IconRobotMonitor,
  IconTelegram,
} from "../../components/Icon";

const navCards = [
  {
    to: "/admin/users",
    Icon: IconProfile,
    label: "Usuários",
    description: "Ver todos os usuários, trocar role e suspender contas",
  },
  {
    to: "/admin/roles",
    Icon: IconShield,
    label: "Gestão de Roles",
    description: "Papéis, permissões por tela e atribuição de usuários",
  },
  {
    to: "/admin/screens",
    Icon: IconSparkle,
    label: "Telas & Permissões",
    description: "Controle o que usuários comuns veem no app",
  },
  {
    to: "/admin/payments",
    Icon: IconCheck,
    label: "Aprovação de Pagamentos",
    description: "Revisar comprovantes de Pix e aprovar assinaturas VIP",
  },
] as const;

/**
 * One market's editable "odd indicada" row — blank means no override set
 * (that market's "Lucro com odd indicada" stat stays hidden on its detail
 * page). Commits on blur/Enter, same pattern robotip's own stake_pct editor
 * uses (frontend/src/pages/PerformancePage.jsx).
 */
function MarketOddRow({
  entry,
  onSaved,
}: {
  entry: RobotMarketOddEntry;
  onSaved: (groupKey: string, indicatedOdd: number | null) => void;
}) {
  const [raw, setRaw] = useState(entry.indicatedOdd?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  async function commit() {
    const trimmed = raw.trim().replace(",", ".");
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && !Number.isFinite(next)) {
      setRaw(entry.indicatedOdd?.toString() ?? "");
      return;
    }
    if (next === entry.indicatedOdd) return;
    setSaving(true);
    try {
      await updateRobotMarketOdd(entry.groupKey, next);
      onSaved(entry.groupKey, next);
    } catch {
      setRaw(entry.indicatedOdd?.toString() ?? "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">{entry.market}</span>
      <input
        type="text"
        inputMode="decimal"
        placeholder="—"
        value={raw}
        disabled={saving}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-20 rounded-lg border border-border-strong bg-surface-alt px-2.5 py-1.5 text-right font-mono text-[13px] text-text outline-none disabled:opacity-50"
      />
    </div>
  );
}

/**
 * "Histórico do Robô" — per-market "odd indicada" editor. Setting a value
 * here adds an extra "Lucro com odd indicada" stat on that market's detail
 * page: total profit if every green op had been bet at this odd instead of
 * its own real recorded odd (the real green/red result stays real, only the
 * odd changes). The main "Lucro" figure always uses each operation's real
 * recorded odd, unaffected by this — see aggregatePerformance in
 * robot-signals/routes.ts.
 */
function RobotMarketOddsCard() {
  const [entries, setEntries] = useState<RobotMarketOddEntry[] | null>(null);

  useEffect(() => {
    fetchRobotMarketOdds().then(setEntries);
  }, []);

  function handleSaved(groupKey: string, indicatedOdd: number | null) {
    setEntries((prev) => prev?.map((e) => (e.groupKey === groupKey ? { ...e, indicatedOdd } : e)) ?? null);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-3.5 p-4">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-accent-soft text-accent">
          <IconRobotMonitor size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold">Histórico do Robô · odd indicada</div>
          <div className="mt-0.5 text-[12px] text-text-tertiary">
            Odd fixa por mercado usada só pra simular o "Lucro com odd indicada" no gráfico do
            mercado — não muda o Lucro real.
          </div>
        </div>
      </div>
      {entries === null && (
        <p className="px-4 pb-4 text-center text-[12px] text-text-tertiary">Carregando…</p>
      )}
      {entries?.length === 0 && (
        <p className="px-4 pb-4 text-center text-[12px] text-text-tertiary">
          Nenhum mercado encontrado.
        </p>
      )}
      {entries && entries.length > 0 && (
        <div className="border-t border-border">
          {entries.map((entry) => (
            <MarketOddRow key={entry.groupKey} entry={entry} onSaved={handleSaved} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Fixo em 10/09/2026 00:00 América/São Paulo, como unix seconds — data a
 * partir da qual "reconstruir do zero" sempre reimporta. */
const REBUILD_SINCE_UNIX = Date.UTC(2026, 8, 10, 3, 0, 0) / 1000;
const REBUILD_SINCE_LABEL = "10/09/2026";

/**
 * Apaga toda a tip do Telegram e reimporta desde REBUILD_SINCE_UNIX, reusando
 * a sessão MTProto já conectada do worker (roda dentro da própria API, sem
 * SSH). Ação destrutiva — dupla confirmação antes de disparar.
 */
function TelegramRebuildCard() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ group: string; messages: number; created: number; skipped: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!confirm(`Isso apaga TODAS as tips do VIP Telegram e reimporta tudo desde ${REBUILD_SINCE_LABEL} 00:00. Confirma?`)) return;
    if (!confirm("Tem certeza? Essa ação não pode ser desfeita.")) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const { results } = await rebuildTelegramTips(REBUILD_SINCE_UNIX);
      setResult(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao reconstruir");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-2xl border border-live/30 bg-surface">
      <div className="flex items-center gap-3.5 p-4">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-live/10 text-live">
          <IconTelegram size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold">VIP Telegram · reconstruir do zero</div>
          <div className="mt-0.5 text-[12px] text-text-tertiary">
            Apaga toda tip e reimporta desde {REBUILD_SINCE_LABEL}, com o parser atual. Ação destrutiva.
          </div>
        </div>
        <button
          onClick={handleClick}
          disabled={running}
          className="flex-none rounded-[11px] border border-live/40 px-4 py-2 text-[13px] font-semibold text-live disabled:opacity-50"
        >
          {running ? "Reconstruindo…" : "Reconstruir"}
        </button>
      </div>
      {error && <p className="border-t border-border px-4 py-3 text-[12.5px] text-live">{error}</p>}
      {result && (
        <div className="border-t border-border px-4 py-3">
          {result.map((r) => (
            <div key={r.group} className="flex items-center justify-between text-[12.5px] text-text-secondary">
              <span>{r.group}</span>
              <span className="font-mono text-text-tertiary">
                {r.messages} msgs · {r.created} criadas · {r.skipped} ignoradas
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Lets the admin pick a color per bookmaker, shown as a small dot next to
 * each casa in the VIP Telegram report's "Por casa de aposta" table —
 * stored in TelegramBancaSettings.bookmakerColors, one PUT per change. */
function BookmakerColorsCard() {
  const [names, setNames] = useState<string[]>([]);
  const [settings, setSettings] = useState<TelegramBancaSettings | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetchBookmakerNames().then(setNames).catch(() => {});
    fetchTelegramSettings().then(setSettings).catch(() => {});
  }, []);

  async function setColor(bookmaker: string, color: string) {
    if (!settings) return;
    setSaving(bookmaker);
    try {
      const updated = await saveTelegramSettings({
        unitValue: settings.unitValue,
        bookmakerColors: { ...(settings.bookmakerColors ?? {}), [bookmaker]: color },
      });
      setSettings(updated);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-[14.5px] font-semibold">Cores das casas de aposta</div>
      <div className="mt-0.5 text-[12px] text-text-tertiary">
        Escolha uma cor por casa — aparece como uma bolinha ao lado do nome no relatório do VIP Telegram.
      </div>
      <div className="mt-3 flex max-h-[420px] flex-col gap-2.5 overflow-y-auto pr-1">
        {names.map((name) => {
          const current = settings?.bookmakerColors?.[name] ?? null;
          return (
            <div key={name} className="flex items-center gap-3 border-b border-border-subtle pb-2.5 last:border-0">
              <input
                type="color"
                value={current ?? "#8a8a8a"}
                onChange={(e) => setColor(name, e.target.value)}
                disabled={saving === name}
                aria-label={`Cor de ${bookmakerLabel(name)}`}
                className="h-8 w-8 flex-none cursor-pointer rounded-lg border border-border-strong bg-transparent p-0 disabled:opacity-50"
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{bookmakerLabel(name)}</span>
            </div>
          );
        })}
        {names.length === 0 && (
          <p className="py-6 text-center text-[12px] text-text-tertiary">Nenhuma casa encontrada ainda.</p>
        )}
      </div>
    </div>
  );
}

export function AdminPage() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<AdminOverview | null>(null);

  useEffect(() => {
    fetchAdminOverview().then(setOverview);
  }, []);

  return (
    <div className="min-h-dvh bg-bg text-text lg:flex lg:min-h-full lg:flex-col">
      {/* ---------- Desktop ---------- */}
      <div className="hidden lg:flex lg:h-[70px] lg:flex-none lg:items-center lg:border-b lg:border-border lg:px-8">
        <span className="text-[20px] font-bold tracking-[-0.02em]">Painel Admin</span>
        <span className="ml-3 font-mono text-[12px] text-text-tertiary">Controle da plataforma</span>
      </div>

      <div className="hidden lg:block lg:flex-1 lg:px-8 lg:py-6">
        <div className="mb-6 flex gap-4">
          <div className="flex-1 rounded-2xl border border-border bg-surface p-5">
            <div className="font-mono text-[26px] font-bold">{overview?.tipstersCount ?? "—"}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.05em] text-text-tertiary">
              Tipsters
            </div>
          </div>
          <div className="flex-1 rounded-2xl border border-border bg-surface p-5">
            <div className="font-mono text-[26px] font-bold">{overview?.usersCount ?? "—"}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.05em] text-text-tertiary">
              Usuários
            </div>
          </div>
        </div>

        <div className="mb-3 font-mono text-[11px] tracking-[0.1em] text-text-tertiary">GESTÃO</div>
        <div className="grid grid-cols-4 gap-4">
          {navCards.map(({ to, Icon, label, description }) => (
            <Link
              key={to}
              to={to}
              className="flex flex-col gap-3.5 rounded-2xl border border-border bg-surface p-5"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
                <Icon size={18} />
              </div>
              <div>
                <div className="text-[14.5px] font-semibold">{label}</div>
                <div className="mt-0.5 text-[12px] text-text-tertiary">{description}</div>
              </div>
            </Link>
          ))}
        </div>

        <div className="mb-3 mt-6 font-mono text-[11px] tracking-[0.1em] text-text-tertiary">ROBÔ</div>
        <RobotMarketOddsCard />

        <div className="mb-3 mt-6 font-mono text-[11px] tracking-[0.1em] text-text-tertiary">MANUTENÇÃO</div>
        <div className="flex flex-col gap-4">
          <TelegramRebuildCard />
          <BookmakerColorsCard />
        </div>
      </div>

      {/* ---------- Mobile ---------- */}
      <div className="pb-8 lg:hidden">
      <div className="flex items-center gap-3.5 border-b border-border px-4 pb-3.5 pt-14">
        <button onClick={() => navigate(-1)} aria-label="Voltar">
          <IconChevronLeft size={22} />
        </button>
        <div>
          <div className="text-[16px] font-bold">Painel Admin</div>
          <div className="text-[11.5px] text-text-secondary">Controle da plataforma</div>
        </div>
      </div>

      <div className="flex gap-2.5 p-4">
        <div className="flex-1 rounded-2xl border border-border bg-surface p-3.5">
          <div className="font-mono text-[19px] font-bold">{overview?.tipstersCount ?? "—"}</div>
          <div className="mt-0.5 text-[10.5px] uppercase text-text-tertiary">Tipsters</div>
        </div>
        <div className="flex-1 rounded-2xl border border-border bg-surface p-3.5">
          <div className="font-mono text-[19px] font-bold">{overview?.usersCount ?? "—"}</div>
          <div className="mt-0.5 text-[10.5px] uppercase text-text-tertiary">Usuários</div>
        </div>
      </div>

      <div className="px-4 pb-2 font-mono text-[11px] tracking-[0.1em] text-text-tertiary">
        GESTÃO
      </div>
      <div className="flex flex-col gap-2.5 px-4">
        {navCards.map(({ to, Icon, label, description }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3.5 rounded-2xl border border-border bg-surface p-4"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
              <Icon size={18} />
            </div>
            <div className="flex-1">
              <div className="text-[14.5px] font-semibold">{label}</div>
              <div className="text-[12px] text-text-tertiary">{description}</div>
            </div>
            <span className="text-text-tertiary">›</span>
          </Link>
        ))}
      </div>

      <div className="px-4 pb-2 pt-5 font-mono text-[11px] tracking-[0.1em] text-text-tertiary">
        ROBÔ
      </div>
      <div className="px-4">
        <RobotMarketOddsCard />
      </div>

      <div className="px-4 pb-2 pt-5 font-mono text-[11px] tracking-[0.1em] text-text-tertiary">
        MANUTENÇÃO
      </div>
      <div className="flex flex-col gap-4 px-4">
        <TelegramRebuildCard />
        <BookmakerColorsCard />
      </div>
      </div>
    </div>
  );
}
