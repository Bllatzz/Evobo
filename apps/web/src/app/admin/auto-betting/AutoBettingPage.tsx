import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AutoBetRunStatus, AutoBetRunView, AutoBetSettingsView } from "@evobo/shared-types";
import { IconChevronLeft, IconExternalLink } from "../../../components/Icon";
import { Toggle } from "../../../components/Toggle";
import { AutoBettingCard } from "../../profile-me/AutoBettingCard";
import {
  fetchAutoBetRuns,
  fetchAutoBetSettings,
  fetchExtensionKey,
  updateAutoBetSettings,
  type ExtensionKeyInfo,
} from "../../../lib/autoBetting";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function timeAgo(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** A extensão consulta o Evobo a cada poucos segundos (e marca o último uso a cada 30s). */
const ONLINE_MS = 90_000;

const STATUS_STYLE: Record<AutoBetRunStatus, { label: string; className: string }> = {
  apostou: { label: "APOSTOU", className: "border-accent/40 bg-accent/10 text-accent" },
  conferiu: { label: "CONFERIU", className: "border-border-strong bg-surface-chip text-text-secondary" },
  pulou: { label: "PULOU", className: "border-border-strong bg-surface-chip text-text-tertiary" },
  abortou: { label: "ABORTOU", className: "border-live/40 bg-live/10 text-live" },
  verificar: { label: "VERIFICAR", className: "border-vip-border bg-vip-soft text-vip" },
  erro: { label: "ERRO", className: "border-live/40 bg-live/10 text-live" },
};

const card = "rounded-2xl border border-border bg-surface p-4 lg:p-5";
const label = "mb-1 font-mono text-[10px] tracking-[0.05em] text-text-tertiary";

/**
 * "Aposta automática" — tudo que a extensão faz é configurado e acompanhado
 * aqui: liga/desliga, modo (só conferir / apostar de verdade), teto por
 * aposta, se a extensão está conectada e o histórico de cada tip. A extensão
 * só lê isso da API (e tem o "Testar um link"). Só admin.
 */
export function AutoBettingPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AutoBetSettingsView | null>(null);
  const [runs, setRuns] = useState<AutoBetRunView[] | null>(null);
  const [extensionKey, setExtensionKey] = useState<ExtensionKeyInfo>(null);
  const [maxStakeRaw, setMaxStakeRaw] = useState("");
  const [confirmReal, setConfirmReal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [, setTick] = useState(0);

  async function load() {
    const [s, r, k] = await Promise.all([fetchAutoBetSettings(), fetchAutoBetRuns(40), fetchExtensionKey()]);
    setSettings(s);
    setRuns(r);
    setExtensionKey(k.key);
    return s;
  }

  useEffect(() => {
    load()
      .then((s) => setMaxStakeRaw(String(s.maxStakeReais)))
      .catch(() => setError("Não foi possível carregar a aposta automática."));
    // Histórico e "extensão conectada" ao vivo enquanto a tela está aberta.
    const poll = setInterval(() => load().catch(() => {}), 10_000);
    const tick = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  async function save(input: Parameters<typeof updateAutoBetSettings>[0]) {
    setSaving(true);
    setError(null);
    try {
      const s = await updateAutoBetSettings(input);
      setSettings(s);
      setMaxStakeRaw(String(s.maxStakeReais));
    } catch {
      setError("Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  function saveMaxStake() {
    const value = Number(maxStakeRaw.replace(",", "."));
    if (!settings || !Number.isFinite(value) || value <= 0) {
      setMaxStakeRaw(String(settings?.maxStakeReais ?? ""));
      return;
    }
    if (value !== settings.maxStakeReais) void save({ maxStakeReais: value });
  }

  const online = !!extensionKey?.lastUsedAt && Date.now() - new Date(extensionKey.lastUsedAt).getTime() < ONLINE_MS;

  return (
    <div className="min-h-dvh bg-bg pb-28 text-text lg:mx-auto lg:max-w-[760px] lg:px-8 lg:pb-16 lg:pt-8">
      <div className="flex items-center gap-3 px-4 pb-3.5 pt-14 lg:px-0 lg:pt-0">
        <button onClick={() => navigate(-1)} className="text-text lg:hidden" aria-label="Voltar">
          <IconChevronLeft size={22} />
        </button>
        <div className="flex-1">
          <div className="text-[20px] font-bold tracking-[-0.02em] lg:text-[22px]">Aposta automática</div>
          <div className="font-mono text-[11px] text-text-tertiary">Betano · a extensão do Chrome segue o que está aqui</div>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 lg:px-0">
        {settings === null ? (
          <div className={card}>
            <p className="text-[12px] text-text-tertiary">{error ?? "Carregando…"}</p>
          </div>
        ) : (
          <>
            {/* Liga/desliga + extensão conectada */}
            <div className={card}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[16px] font-bold">{settings.enabled ? "Ligada" : "Desligada"}</div>
                  <div className="text-[12px] text-text-tertiary">
                    {settings.enabled && settings.enabledSince
                      ? `Pegando tips que chegaram desde ${clock(settings.enabledSince)}`
                      : "Nenhuma tip é aberta enquanto estiver desligada"}
                  </div>
                </div>
                <Toggle on={settings.enabled} onChange={() => !saving && void save({ enabled: !settings.enabled })} />
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[12px]">
                <span className={`h-2 w-2 flex-none rounded-full ${online ? "bg-accent" : "bg-text-quaternary"}`} />
                {!extensionKey ? (
                  <span className="text-text-tertiary">Extensão sem chave — gere uma em "Configurar a extensão" abaixo</span>
                ) : online ? (
                  <span className="text-text-secondary">Extensão conectada</span>
                ) : (
                  <span className="text-text-tertiary">
                    Extensão offline{extensionKey.lastUsedAt ? ` · vista ${timeAgo(extensionKey.lastUsedAt)}` : " · nunca conectou"} — o Chrome
                    precisa estar aberto
                  </span>
                )}
              </div>
            </div>

            {/* Modo */}
            <div className={card}>
              <div className="mb-2 text-[14px] font-bold">Modo</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { real: false, title: "Só conferir", desc: "Abre, confere a odd e preenche a stake. Não aposta." },
                  { real: true, title: "Apostar de verdade", desc: 'Clica em "APOSTE JÁ" e reage 👍 na mensagem.' },
                ].map((m) => {
                  const active = settings.placeReal === m.real;
                  return (
                    <button
                      key={m.title}
                      disabled={saving}
                      onClick={() => {
                        if (active) return;
                        if (m.real) setConfirmReal(true);
                        else void save({ placeReal: false });
                      }}
                      className={`rounded-[12px] border px-3 py-2.5 text-left transition-colors ${
                        active ? (m.real ? "border-accent bg-accent/10" : "border-border-strong bg-surface-chip") : "border-border hover:border-border-strong"
                      }`}
                    >
                      <div className={`text-[13px] font-semibold ${active && m.real ? "text-accent" : ""}`}>
                        {active ? "● " : ""}
                        {m.title}
                      </div>
                      <div className="mt-0.5 text-[11px] leading-snug text-text-tertiary">{m.desc}</div>
                    </button>
                  );
                })}
              </div>
              {confirmReal && (
                <div className="mt-3 rounded-[12px] border border-vip-border bg-vip-soft p-3 text-[12px]">
                  A extensão vai apostar sozinha nas tips novas, até <b>{brl(settings.maxStakeReais)}</b> por aposta.
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        setConfirmReal(false);
                        void save({ placeReal: true });
                      }}
                      className="rounded-[10px] bg-accent px-3 py-1.5 text-[12px] font-semibold text-[#08090A]"
                    >
                      Sim, apostar de verdade
                    </button>
                    <button onClick={() => setConfirmReal(false)} className="rounded-[10px] border border-border-strong px-3 py-1.5 text-[12px] font-semibold">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Valores */}
            <div className={card}>
              <div className="mb-3 text-[14px] font-bold">Valores</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={label}>TETO POR APOSTA</div>
                  <div className="flex items-center rounded-[10px] border border-border-strong bg-surface-chip px-3">
                    <span className="text-[13px] text-text-tertiary">R$</span>
                    <input
                      value={maxStakeRaw}
                      onChange={(e) => setMaxStakeRaw(e.target.value)}
                      onBlur={saveMaxStake}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      inputMode="decimal"
                      className="w-full bg-transparent px-2 py-2 text-[13px] outline-none"
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-text-tertiary">Stake maior que isso não é apostada.</div>
                </div>
                <div>
                  <div className={label}>VALOR DA UNIDADE</div>
                  <div className="rounded-[10px] border border-border bg-surface-chip px-3 py-2 text-[13px]">
                    {settings.unitValueReais !== null ? brl(settings.unitValueReais) : <span className="text-live">não definido</span>}
                  </div>
                  <Link to="/profile" className="mt-1 inline-block text-[11px] font-semibold text-accent">
                    alterar em Meu perfil → Unidade & saldos
                  </Link>
                </div>
              </div>
              {settings.unitValueReais === null && (
                <p className="mt-3 text-[12px] text-live">Sem valor da unidade a extensão não consegue calcular a stake — nenhuma tip é apostada.</p>
              )}
            </div>

            {/* Histórico */}
            <div className={card}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[14px] font-bold">Histórico</span>
                <span className="font-mono text-[10px] text-text-tertiary">atualiza sozinho</span>
              </div>
              {runs === null ? (
                <p className="text-[12px] text-text-tertiary">Carregando…</p>
              ) : runs.length === 0 ? (
                <p className="text-[12px] text-text-tertiary">Nada ainda. Cada tip que a extensão abrir aparece aqui.</p>
              ) : (
                <div className="flex flex-col divide-y divide-border">
                  {runs.map((r) => {
                    const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.erro;
                    const open = openRun === r.id;
                    return (
                      <div key={r.id} className="py-2.5">
                        <div className="flex items-start gap-2">
                          <span className={`mt-0.5 flex-none rounded-full border px-2 py-0.5 font-mono text-[9.5px] ${st.className}`}>{st.label}</span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] font-semibold">
                              {r.title ?? r.betUrl ?? r.taskKey}
                              {r.taskKey.startsWith("manual:") && <span className="ml-1.5 font-mono text-[10px] font-normal text-text-tertiary">teste</span>}
                            </div>
                            <div className="whitespace-pre-wrap text-[12px] text-text-secondary">{r.summary}</div>
                            <div className="mt-0.5 flex items-center gap-3 font-mono text-[10px] text-text-tertiary">
                              <span>{timeAgo(r.createdAt)}</span>
                              {r.dryRun && <span>só conferindo</span>}
                              {r.betUrl && (
                                <a href={r.betUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent">
                                  link <IconExternalLink size={10} />
                                </a>
                              )}
                              <button onClick={() => setOpenRun(open ? null : r.id)} className="text-text-tertiary underline">
                                {open ? "esconder detalhes" : "detalhes"}
                              </button>
                            </div>
                            {open && (
                              <pre className="mt-2 max-h-72 overflow-auto rounded-[10px] bg-surface-chip p-2 font-mono text-[10.5px] text-text-secondary">
                                {JSON.stringify(r.report, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Setup: login da casa + chave */}
            <details className="group">
              <summary className="cursor-pointer select-none px-1 py-2 text-[13px] font-bold text-text-secondary">Configurar a extensão (login da casa e chave)</summary>
              <div className="mt-2">
                <AutoBettingCard />
              </div>
            </details>

            {error && <p className="text-[12px] text-live">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
