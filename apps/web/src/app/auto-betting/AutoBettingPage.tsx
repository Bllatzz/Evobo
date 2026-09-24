import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AUTO_BET_BOOKMAKERS, type AutoBetBookmaker, type AutoBetRunView, type AutoBetSettingsView } from "@evobo/shared-types";
import { IconCheck, IconChevronLeft } from "../../components/Icon";
import { Toggle } from "../../components/Toggle";
import { bookmakerLabel } from "../../lib/bookmakers";
import {
  createExtensionKey,
  deleteCredential,
  fetchAutoBetRuns,
  fetchAutoBetSettings,
  fetchCredentials,
  fetchExtensionKey,
  revokeExtensionKey,
  saveCredential,
  updateAutoBetSettings,
  type ExtensionKeyInfo,
  type SavedCredential,
} from "../../lib/autoBetting";

/*
 * "Aposta automática" — desenho do Claude Design (BANCA App.dc.html, frames
 * "D27 · Desktop · Aposta automática" e "27 · Aposta automática").
 * Cada usuário com acesso ao VIP Telegram configura a SUA automação aqui:
 * liga/desliga, modo, teto, logins das casas, chave da extensão, e acompanha
 * o histórico. A extensão do Chrome só segue isso (e tem "Testar um link").
 */

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const odd = (n: number | null) => (n === null ? "—" : n.toFixed(2));
const dayMonth = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const hourMin = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** A extensão consulta o Evobo a cada poucos segundos e o "último uso" é gravado a cada 30s. */
const ONLINE_MS = 90_000;

const card = "rounded-2xl border border-border bg-surface p-4 lg:p-5";
const fieldLabel = "mb-1.5 font-mono text-[10px] tracking-[0.06em] text-text-tertiary";
const inputClass = "w-full rounded-[10px] border border-border-strong bg-surface-chip px-3 py-2 text-[13px] outline-none focus:border-accent";

// Casas: as suportadas pela extensão + as que ainda vão chegar.
const COMING_SOON: { slug: string; label: string }[] = [{ slug: "bet365", label: "Bet365" }];
const BOOKMAKER_BADGE: Record<string, { letter: string; className: string }> = {
  betano: { letter: "B", className: "bg-orange text-white" },
  bet365: { letter: "3", className: "bg-[#126E51] text-[#FFDF1B]" },
};

type Tab = "configurar" | "casas" | "historico";

export function AutoBettingPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AutoBetSettingsView | null>(null);
  const [credentials, setCredentials] = useState<SavedCredential[] | null>(null);
  const [encryptionOn, setEncryptionOn] = useState(true);
  const [extensionKey, setExtensionKey] = useState<ExtensionKeyInfo>(null);
  const [runs, setRuns] = useState<AutoBetRunView[] | null>(null);
  const [days, setDays] = useState<1 | 7 | 30>(1);
  const [tab, setTab] = useState<Tab>("configurar");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  async function loadBase() {
    const [s, c, k] = await Promise.all([fetchAutoBetSettings(), fetchCredentials(), fetchExtensionKey()]);
    setSettings(s);
    setCredentials(c.credentials);
    setEncryptionOn(c.enabled);
    setExtensionKey(k.key);
  }

  useEffect(() => {
    loadBase().catch(() => setError("Não foi possível carregar a aposta automática."));
    // "Extensão conectada" e o estado ligado/desligado ao vivo (a extensão também liga/desliga).
    const poll = setInterval(() => loadBase().catch(() => {}), 15_000);
    const tick = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    const load = () => fetchAutoBetRuns(days).then(setRuns).catch(() => {});
    setRuns(null);
    load();
    const poll = setInterval(load, 10_000);
    return () => clearInterval(poll);
  }, [days]);

  async function save(input: Parameters<typeof updateAutoBetSettings>[0]) {
    setSaving(true);
    setError(null);
    try {
      setSettings(await updateAutoBetSettings(input));
    } catch {
      setError("Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  const online = !!extensionKey?.lastUsedAt && Date.now() - new Date(extensionKey.lastUsedAt).getTime() < ONLINE_MS;

  if (!settings || !credentials) {
    return (
      <div className="min-h-dvh bg-bg p-6 text-[13px] text-text-tertiary">{error ?? "Carregando…"}</div>
    );
  }

  const steps = setupSteps(settings, credentials, extensionKey);
  const modo = <ModeCard settings={settings} saving={saving} onSave={save} />;
  const valores = <ValuesCard settings={settings} onSave={save} />;
  const casas = (
    <HousesCard
      credentials={credentials}
      encryptionOn={encryptionOn}
      extensionKey={extensionKey}
      onChanged={() => loadBase().catch(() => {})}
    />
  );
  const historico = <HistoryCard runs={runs} days={days} setDays={setDays} />;
  const setup = <SetupCard steps={steps} />;
  const pula = <SkipRulesCard />;
  const liga = <OnOffPill on={settings.enabled} disabled={saving} onToggle={() => void save({ enabled: !settings.enabled })} />;
  const status = <ExtensionStatus online={online} extensionKey={extensionKey} />;

  return (
    <div className="min-h-dvh bg-bg pb-28 text-text lg:pb-10">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 px-4 pb-3 pt-14 lg:border-b lg:border-border lg:px-8 lg:py-4">
        <button onClick={() => navigate(-1)} className="text-text lg:hidden" aria-label="Voltar">
          <IconChevronLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <span className="text-[20px] font-bold tracking-[-0.02em] lg:text-[22px]">Aposta automática</span>
          </div>
          <div className="lg:hidden">{status}</div>
        </div>
        <div className="hidden lg:block">{status}</div>
        {liga}
      </div>

      {error && <p className="px-4 pb-2 text-[12px] text-live lg:px-8">{error}</p>}

      {/* Desktop: duas colunas */}
      <div className="hidden gap-4 px-8 pt-5 lg:flex">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            {modo}
            {valores}
          </div>
          {casas}
          {historico}
        </div>
        <div className="flex w-[280px] flex-none flex-col gap-4">
          {setup}
          {pula}
        </div>
      </div>

      {/* Celular: abas */}
      <div className="px-4 lg:hidden">
        <div className="mb-3 grid grid-cols-3 rounded-[12px] border border-border bg-surface p-1">
          {(
            [
              ["configurar", "Configurar"],
              ["casas", "Casas"],
              ["historico", "Histórico"],
            ] as const
          ).map(([key, text]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-[9px] py-2 text-[13px] font-semibold ${tab === key ? "bg-accent-soft text-accent" : "text-text-secondary"}`}
            >
              {text}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {tab === "configurar" && (
            <>
              {setup}
              {modo}
              {valores}
              {pula}
            </>
          )}
          {tab === "casas" && casas}
          {tab === "historico" && historico}
        </div>
      </div>
    </div>
  );
}

function ExtensionStatus({ online, extensionKey }: { online: boolean; extensionKey: ExtensionKeyInfo }) {
  const text = !extensionKey ? "extensão sem chave" : online ? "extensão conectada" : "extensão offline";
  return (
    <span className="flex items-center gap-1.5 font-mono text-[11px] text-text-tertiary lg:mr-3 lg:font-sans lg:text-[12px] lg:text-text-secondary">
      <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-accent" : "bg-text-quaternary"}`} />
      <span className="lg:first-letter:uppercase">{text}</span>
    </span>
  );
}

function OnOffPill({ on, disabled, onToggle }: { on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <div className="flex flex-none items-center gap-2.5 rounded-[12px] border border-border-strong bg-surface px-3 py-1.5">
      <span className="text-[13px] font-bold">{on ? "Ligada" : "Desligada"}</span>
      <Toggle on={on} onChange={() => !disabled && onToggle()} />
    </div>
  );
}

function ModeCard({
  settings,
  saving,
  onSave,
}: {
  settings: AutoBetSettingsView;
  saving: boolean;
  onSave: (i: { placeReal: boolean }) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const options = [
    { real: false, title: "Só conferir", desc: "Abre, confere a odd e preenche a stake. Não aposta." },
    { real: true, title: "Apostar de verdade", desc: 'Clica em "APOSTE JÁ" e reage na mensagem do grupo.' },
  ];
  return (
    <div className={card}>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[14px] font-bold">Modo</span>
        <span className="font-mono text-[10.5px] text-text-tertiary">o que a extensão faz ao abrir a tip</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const active = settings.placeReal === o.real;
          return (
            <button
              key={o.title}
              disabled={saving}
              onClick={() => {
                if (active) return;
                if (o.real) setConfirm(true);
                else void onSave({ placeReal: false });
              }}
              className={`rounded-[12px] border px-3 py-2.5 text-left transition-colors ${
                active ? "border-accent bg-accent-soft" : "border-border bg-surface-chip hover:border-border-strong"
              }`}
            >
              <div className={`text-[13px] font-semibold ${active ? "text-accent" : ""}`}>
                {active && "● "}
                {o.title}
              </div>
              <div className="mt-1 text-[11.5px] leading-snug text-text-tertiary">{o.desc}</div>
            </button>
          );
        })}
      </div>
      {confirm && (
        <div className="mt-3 rounded-[12px] border border-vip-border bg-vip-soft p-3 text-[12px]">
          A extensão vai apostar sozinha nas tips novas, até <b>{brl(settings.maxStakeReais)}</b> por aposta.
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                setConfirm(false);
                void onSave({ placeReal: true });
              }}
              className="rounded-[10px] bg-accent px-3 py-1.5 text-[12px] font-semibold text-[#08090A]"
            >
              Sim, apostar de verdade
            </button>
            <button onClick={() => setConfirm(false)} className="rounded-[10px] border border-border-strong px-3 py-1.5 text-[12px] font-semibold">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ValuesCard({ settings, onSave }: { settings: AutoBetSettingsView; onSave: (i: { maxStakeReais: number }) => Promise<void> }) {
  const [raw, setRaw] = useState(settings.maxStakeReais.toFixed(0));
  useEffect(() => setRaw(settings.maxStakeReais.toFixed(0)), [settings.maxStakeReais]);

  function commit() {
    const value = Number(raw.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return setRaw(settings.maxStakeReais.toFixed(0));
    if (value !== settings.maxStakeReais) void onSave({ maxStakeReais: value });
  }

  return (
    <div className={card}>
      <div className="mb-3 text-[14px] font-bold">Valores</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={fieldLabel}>TETO POR APOSTA</div>
          <div className="flex items-center rounded-[10px] border border-border-strong bg-surface-chip px-3 focus-within:border-accent">
            <span className="font-mono text-[12px] text-text-tertiary">R$</span>
            <input
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              inputMode="decimal"
              aria-label="Teto por aposta em reais"
              className="w-full bg-transparent px-2 py-2 font-mono text-[14px] font-semibold outline-none"
            />
          </div>
        </div>
        <div>
          <div className={fieldLabel}>VALOR DA UNIDADE</div>
          <div className="flex items-center rounded-[10px] border border-border bg-surface-chip px-3 py-2">
            <span className="font-mono text-[12px] text-text-tertiary">R$</span>
            <span className={`px-2 font-mono text-[14px] font-semibold ${settings.unitValueReais === null ? "text-live" : ""}`}>
              {settings.unitValueReais === null ? "—" : settings.unitValueReais.toFixed(2).replace(".", ",")}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 text-[11px]">
        <span className="text-text-tertiary">Stake maior que isso não é apostada.</span>
        <Link to="/profile" className="font-semibold text-accent">
          alterar em Meu perfil
        </Link>
      </div>
      {settings.unitValueReais === null && (
        <p className="mt-2 text-[11.5px] text-live">Sem valor da unidade a extensão não calcula a stake — nenhuma tip é apostada.</p>
      )}
    </div>
  );
}

function HousesCard({
  credentials,
  encryptionOn,
  extensionKey,
  onChanged,
}: {
  credentials: SavedCredential[];
  encryptionOn: boolean;
  extensionKey: ExtensionKeyInfo;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<AutoBetBookmaker | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onRemove(b: AutoBetBookmaker) {
    if (!confirm(`Remover o login da ${bookmakerLabel(b)}?`)) return;
    await deleteCredential(b);
    onChanged();
  }

  async function onCreateKey() {
    if (extensionKey && !confirm("Gerar uma chave nova? A atual para de funcionar na extensão.")) return;
    const { key } = await createExtensionKey();
    setNewKey(key);
    setCopied(false);
    onChanged();
  }

  async function onRevokeKey() {
    if (!confirm("Revogar a chave? A extensão para até você colar uma nova.")) return;
    await revokeExtensionKey();
    setNewKey(null);
    onChanged();
  }

  return (
    <div className={card}>
      <div className="mb-0.5 text-[14px] font-bold">Login das casas</div>
      <p className="mb-3 text-[11.5px] text-text-tertiary">A extensão entra sozinha. Fica criptografado e esta tela nunca mostra a senha de volta.</p>
      {!encryptionOn && (
        <p className="mb-3 rounded-[10px] border border-live/40 bg-live-soft px-3 py-2 text-[12px] text-live">
          A criptografia ainda não está configurada na API — não dá pra salvar logins.
        </p>
      )}

      <div className="overflow-hidden rounded-[12px] border border-border">
        {AUTO_BET_BOOKMAKERS.map((b) => {
          const saved = credentials.find((c) => c.bookmaker === b) ?? null;
          return (
            <div key={b} className="border-b border-border last:border-b-0">
              <HouseRow
                slug={b}
                label={bookmakerLabel(b)}
                hint={saved?.usernameHint ?? "—"}
                status={saved ? <span className="text-accent">● conectado · {dayMonth(saved.updatedAt)}</span> : <span className="text-text-tertiary">não conectado</span>}
                actions={
                  saved ? (
                    <>
                      <button onClick={() => setEditing(editing === b ? null : b)} className="text-[12px] font-semibold text-accent">
                        trocar
                      </button>
                      <button onClick={() => void onRemove(b)} className="text-[12px] font-semibold text-live">
                        remover
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setEditing(editing === b ? null : b)}
                      className="rounded-[9px] bg-accent px-3 py-1 text-[12px] font-semibold text-[#08090A]"
                    >
                      Conectar
                    </button>
                  )
                }
              />
              {editing === b && (
                <CredentialForm
                  bookmaker={b}
                  disabled={!encryptionOn}
                  onDone={() => {
                    setEditing(null);
                    onChanged();
                  }}
                  onCancel={() => setEditing(null)}
                />
              )}
            </div>
          );
        })}
        {COMING_SOON.map((b) => (
          <div key={b.slug} className="border-b border-border last:border-b-0">
            <HouseRow
              slug={b.slug}
              label={b.label}
              hint="—"
              status={<span className="text-text-tertiary">em breve</span>}
              actions={<span className="rounded-[9px] border border-border px-3 py-1 text-[12px] text-text-tertiary">em breve</span>}
            />
          </div>
        ))}
      </div>

      {/* Chave da extensão */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold">Chave da extensão</div>
          <div className="text-[11.5px] text-text-tertiary">
            {extensionKey
              ? `Ativa desde ${dateTime(extensionKey.createdAt)} · ${extensionKey.lastUsedAt ? `último uso ${dateTime(extensionKey.lastUsedAt)}` : "ainda não usada"}`
              : "Nenhuma chave — a extensão não consegue entrar."}
          </div>
        </div>
        {extensionKey && !newKey && (
          <span className="rounded-[9px] border border-border bg-surface-chip px-3 py-1.5 font-mono text-[12px] text-text-secondary">evx_••••••••</span>
        )}
        <button onClick={() => void onCreateKey()} className="rounded-[10px] border border-border-strong px-3 py-1.5 text-[12px] font-semibold">
          {extensionKey ? "Gerar nova" : "Gerar chave"}
        </button>
        {extensionKey && (
          <button onClick={() => void onRevokeKey()} className="text-[12px] font-semibold text-live">
            revogar
          </button>
        )}
      </div>
      {newKey && (
        <div className="mt-3 flex flex-col gap-2 rounded-[12px] border border-accent-border bg-accent-soft p-3">
          <p className="text-[12px]">
            Cole no popup da extensão. <b>Ela só aparece agora</b> — se perder, gere outra.
          </p>
          <code className="break-all rounded-[8px] bg-surface-chip px-3 py-2 font-mono text-[11.5px]">{newKey}</code>
          <button
            onClick={() => void navigator.clipboard.writeText(newKey).then(() => setCopied(true))}
            className="self-start rounded-[10px] border border-border-strong px-3 py-1.5 text-[12px] font-semibold"
          >
            {copied ? "Copiada ✓" : "Copiar"}
          </button>
        </div>
      )}
    </div>
  );
}

function HouseRow({ slug, label, hint, status, actions }: { slug: string; label: string; hint: string; status: ReactNode; actions: ReactNode }) {
  const badge = BOOKMAKER_BADGE[slug] ?? { letter: label[0] ?? "?", className: "bg-surface-alt text-text" };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3">
      <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-[8px] text-[13px] font-black ${badge.className}`}>{badge.letter}</span>
      <span className="w-[84px] text-[13px] font-semibold">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-secondary">{hint}</span>
      <span className="text-[11.5px] sm:w-[150px]">{status}</span>
      <span className="ml-auto flex items-center gap-3">{actions}</span>
    </div>
  );
}

function CredentialForm({
  bookmaker,
  disabled,
  onDone,
  onCancel,
}: {
  bookmaker: AutoBetBookmaker;
  disabled: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveCredential(bookmaker, { username, password });
      onDone();
    } catch {
      setError("Não foi possível salvar o login.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-2 border-t border-border bg-surface-chip px-3 py-3 sm:grid-cols-[1fr_1fr_auto]">
      <div>
        <div className={fieldLabel}>USUÁRIO, E-MAIL OU CPF</div>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required className={inputClass} />
      </div>
      <div>
        <div className={fieldLabel}>SENHA</div>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required className={inputClass} />
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" disabled={saving || disabled} className="rounded-[10px] bg-accent px-3 py-2 text-[12px] font-semibold text-[#08090A] disabled:opacity-50">
          {saving ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-[10px] border border-border-strong px-3 py-2 text-[12px] font-semibold">
          Cancelar
        </button>
      </div>
      {error && <p className="text-[12px] text-live sm:col-span-3">{error}</p>}
    </form>
  );
}

// Texto do histórico: só login, stake e resultado. Entradas gravadas por
// versões antigas da extensão ainda trazem "⏱ aba aberta…" — some aqui.
const cleanSummary = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.startsWith("⏱"))
    .join("\n");

// Selo do resultado, como na tabela do design ("Pulado · odd caiu").
function resultBadge(r: AutoBetRunView): { text: string; className: string } {
  const amber = "border-vip-border bg-vip-soft text-vip";
  const red = "border-live/40 bg-live-soft text-live";
  switch (r.status) {
    case "apostou":
      return { text: "Apostado", className: "border-accent-border bg-accent-soft text-accent" };
    case "conferiu":
      return { text: "Conferido", className: "border-verified/40 bg-verified-soft text-verified" };
    case "verificar":
      return { text: "Verificar na casa", className: amber };
    case "pulou":
      return { text: r.reason ? `Pulado · ${r.reason}` : "Pulado", className: r.reason === "acima do teto" ? red : amber };
    case "abortou":
      return { text: r.reason ? `Parou · ${r.reason}` : "Parou", className: red };
    default:
      return { text: "Erro", className: red };
  }
}

function HistoryCard({ runs, days, setDays }: { runs: AutoBetRunView[] | null; days: 1 | 7 | 30; setDays: (d: 1 | 7 | 30) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const filters: [1 | 7 | 30, string][] = [
    [1, "Hoje"],
    [7, "7 dias"],
    [30, "30 dias"],
  ];
  return (
    <div className={card}>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[14px] font-bold">Histórico</span>
        <div className="ml-auto flex gap-1">
          {filters.map(([d, text]) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`whitespace-nowrap rounded-[8px] px-2.5 py-1 text-[11.5px] font-semibold ${days === d ? "bg-accent-soft text-accent" : "text-text-secondary"}`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      {runs === null ? (
        <p className="text-[12px] text-text-tertiary">Carregando…</p>
      ) : runs.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-text-tertiary">Nada nesse período. Cada tip que a extensão abrir aparece aqui.</p>
      ) : (
        <>
          <div className="hidden grid-cols-[52px_minmax(0,1fr)_76px_132px_64px_148px] gap-3 border-b border-border pb-2 font-mono text-[9.5px] tracking-[0.06em] text-text-tertiary lg:grid">
            <span>HORA</span>
            <span>TIP</span>
            <span>CASA</span>
            <span>ODD RECEBIDA → PEGA</span>
            <span>STAKE</span>
            <span>RESULTADO</span>
          </div>
          <div className="flex flex-col divide-y divide-border">
            {runs.map((r) => {
              const badge = resultBadge(r);
              const isOpen = open === r.id;
              const title = r.title ?? r.betUrl ?? r.taskKey;
              const sub = r.taskKey.startsWith("manual:") ? "teste manual" : (r.groupName ?? "");
              return (
                <div key={r.id}>
                  <button onClick={() => setOpen(isOpen ? null : r.id)} className="w-full py-2.5 text-left">
                    {/* desktop: linha da tabela */}
                    <div className="hidden grid-cols-[52px_minmax(0,1fr)_76px_132px_64px_148px] items-center gap-3 lg:grid">
                      <span className="font-mono text-[11.5px] text-text-secondary">{days === 1 ? hourMin(r.createdAt) : dayMonth(r.createdAt)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-semibold">{title}</span>
                        <span className="block truncate text-[10.5px] text-text-tertiary">{sub}</span>
                      </span>
                      <span className="text-[12px]">{bookmakerLabel(r.bookmaker)}</span>
                      <span className="font-mono text-[12px]">
                        {odd(r.tipOdd)} → {odd(r.realOdd)}
                      </span>
                      <span className="font-mono text-[12px]">{r.stakeReais !== null && r.status === "apostou" ? `R$ ${r.stakeReais.toFixed(0)}` : "—"}</span>
                      <span>
                        <span className={`inline-block max-w-full truncate rounded-[7px] border px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>{badge.text}</span>
                      </span>
                    </div>
                    {/* celular: cartão */}
                    <div className="flex items-start gap-3 lg:hidden">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold">{title}</div>
                        <div className="mt-0.5 font-mono text-[10.5px] text-text-tertiary">
                          {hourMin(r.createdAt)} · {bookmakerLabel(r.bookmaker)} · {odd(r.tipOdd)} → {odd(r.realOdd)}
                          {r.stakeReais !== null && r.status === "apostou" ? ` · R$ ${r.stakeReais.toFixed(0)}` : ""}
                        </div>
                      </div>
                      <span className={`flex-none rounded-[7px] border px-2 py-0.5 text-[10.5px] font-semibold ${badge.className}`}>{badge.text}</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="mb-3 rounded-[10px] bg-surface-chip p-3">
                      <div className="whitespace-pre-wrap text-[12px] text-text-secondary">{cleanSummary(r.summary)}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

type Step = { title: string; desc: string; done: boolean };

function setupSteps(settings: AutoBetSettingsView, credentials: SavedCredential[], key: ExtensionKeyInfo): Step[] {
  return [
    { title: "Instalar a extensão", desc: "Adicione a extensão Evobo no Chrome e fixe na barra.", done: !!key },
    { title: "Colar a chave", desc: "Gere a chave em “Login das casas” e cole no popup da extensão.", done: !!key?.lastUsedAt },
    { title: "Conectar a casa", desc: "Faça login da casa em “Login das casas”. A extensão entra sozinha.", done: credentials.length > 0 },
    { title: "Definir modo e valores", desc: "Comece em “Só conferir” até confiar nas entradas, depois mude.", done: settings.unitValueReais !== null },
    { title: "Ligar e deixar o Chrome aberto", desc: "Tips novas dos grupos entram automáticas enquanto estiver ligada.", done: settings.enabled },
  ];
}

const SETUP_HIDDEN_KEY = "evobo:auto-betting:setup-hidden";

function SetupCard({ steps }: { steps: Step[] }) {
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(SETUP_HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(SETUP_HIDDEN_KEY, "1");
    } catch {
      /* sem storage: só nesta visita */
    }
  };

  if (hidden && allDone) {
    return (
      <button onClick={() => setHidden(false)} className={`${card} flex items-center gap-2 text-left text-[12.5px] font-semibold`}>
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[#08090A]">
          <IconCheck size={12} />
        </span>
        Tudo configurado
        <span className="ml-auto font-mono text-[11px] text-text-tertiary">ver passos</span>
      </button>
    );
  }

  return (
    <div className={card}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[14px] font-bold">Como configurar</span>
        <span className="font-mono text-[11px] text-accent">
          {doneCount}/{steps.length}
        </span>
      </div>
      <div className="mb-4 h-1 overflow-hidden rounded-full bg-surface-alt">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="flex flex-col">
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 && <span className={`absolute left-[10px] top-6 h-[calc(100%-20px)] w-px ${s.done ? "bg-accent" : "bg-border-strong"}`} />}
            <span
              className={`relative z-10 flex h-[21px] w-[21px] flex-none items-center justify-center rounded-full font-mono text-[10.5px] ${
                s.done ? "bg-accent text-[#08090A]" : "border border-accent text-accent"
              }`}
            >
              {s.done ? <IconCheck size={12} /> : i + 1}
            </span>
            <span>
              <span className="block text-[13px] font-semibold">{s.title}</span>
              <span className="block text-[11.5px] leading-snug text-text-tertiary">{s.desc}</span>
            </span>
          </li>
        ))}
      </ol>
      {allDone && (
        <button onClick={hide} className="mt-4 rounded-[10px] bg-accent px-3 py-1.5 text-[12px] font-semibold text-[#08090A]">
          Tudo pronto
        </button>
      )}
    </div>
  );
}

function SkipRulesCard() {
  const rules = [
    "a odd na casa está menor que a da tip",
    "a stake passa do teto por aposta",
    "não consegue entrar na casa (login não conectado ou recusado)",
    "a tip ficou sem odd ou unidade (a foto não foi lida)",
  ];
  return (
    <div className={card}>
      <div className="mb-2 text-[13.5px] font-bold">A extensão pula a tip quando</div>
      <ul className="flex flex-col gap-1.5">
        {rules.map((r) => (
          <li key={r} className="flex gap-2 text-[11.5px] leading-snug text-text-secondary">
            <span className="mt-[5px] h-1 w-1 flex-none rounded-full bg-vip" />
            {r}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-text-tertiary">Odd maior que a da tip nunca impede a aposta.</p>
    </div>
  );
}
