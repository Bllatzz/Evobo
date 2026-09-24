import { useEffect, useState, type FormEvent } from "react";
import { AUTO_BET_BOOKMAKERS, type AutoBetBookmaker } from "@evobo/shared-types";
import { bookmakerLabel } from "../../lib/bookmakers";
import {
  createExtensionKey,
  deleteCredential,
  fetchCredentials,
  fetchExtensionKey,
  revokeExtensionKey,
  saveCredential,
  type ExtensionKeyInfo,
  type SavedCredential,
} from "../../lib/autoBetting";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const inputClass = "w-full rounded-[10px] border border-border-strong bg-surface-chip px-3 py-2 text-[13px]";
const labelClass = "mb-1 font-mono text-[10px] tracking-[0.05em] text-text-tertiary";

/** Setup da aposta automática (tela /admin/auto-betting): logins das casas (criptografados na API) e a chave da extensão. Só admin. */
export function AutoBettingCard() {
  const [enabled, setEnabled] = useState(true);
  const [credentials, setCredentials] = useState<SavedCredential[] | null>(null);
  const [extensionKey, setExtensionKey] = useState<ExtensionKeyInfo>(null);
  const [bookmaker, setBookmaker] = useState<AutoBetBookmaker>(AUTO_BET_BOOKMAKERS[0]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function reload() {
    const [c, k] = await Promise.all([fetchCredentials(), fetchExtensionKey()]);
    setEnabled(c.enabled);
    setCredentials(c.credentials);
    setExtensionKey(k.key);
  }

  useEffect(() => {
    reload().catch(() => setError("Não foi possível carregar a aposta automática."));
  }, []);

  const saved = credentials?.find((c) => c.bookmaker === bookmaker) ?? null;
  const showForm = editing || !saved;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveCredential(bookmaker, { username, password });
      setUsername("");
      setPassword("");
      setEditing(false);
      await reload();
    } catch {
      setError("Não foi possível salvar o login.");
    } finally {
      setSaving(false);
    }
  }

  async function onRemove() {
    if (!confirm(`Remover o login da ${bookmakerLabel(bookmaker)}?`)) return;
    await deleteCredential(bookmaker);
    await reload();
  }

  async function onCreateKey() {
    if (extensionKey && !confirm("Gerar uma chave nova? A chave atual para de funcionar na extensão.")) return;
    const { key } = await createExtensionKey();
    setNewKey(key);
    setCopied(false);
    await reload();
  }

  async function onRevokeKey() {
    if (!confirm("Revogar a chave? A extensão para de funcionar até você colar uma chave nova.")) return;
    await revokeExtensionKey();
    setNewKey(null);
    await reload();
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 lg:p-5">
      <div className="mb-1 text-[14px] font-bold">Login da casa</div>
      <p className="mb-4 text-[12px] text-text-tertiary">
        Login da casa pra extensão entrar sozinha. Fica criptografado, e esta tela nunca mostra a senha de volta.
      </p>

      {!enabled && (
        <p className="mb-4 rounded-[10px] border border-live/40 bg-live/10 px-3 py-2 text-[12px] text-live">
          A criptografia ainda não está configurada na API — não dá pra salvar logins.
        </p>
      )}

      <div className="mb-4">
        <div className={labelClass}>CASA</div>
        <select
          value={bookmaker}
          onChange={(e) => {
            setBookmaker(e.target.value as AutoBetBookmaker);
            setEditing(false);
          }}
          className={inputClass}
        >
          {AUTO_BET_BOOKMAKERS.map((b) => (
            <option key={b} value={b}>
              {bookmakerLabel(b)}
            </option>
          ))}
        </select>
      </div>

      {credentials === null ? (
        <p className="text-[12px] text-text-tertiary">Carregando…</p>
      ) : showForm ? (
        <form onSubmit={onSave} className="flex flex-col gap-3">
          <div>
            <div className={labelClass}>USUÁRIO / E-MAIL</div>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              required
              className={inputClass}
            />
          </div>
          <div>
            <div className={labelClass}>SENHA</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              className={inputClass}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !enabled}
              className="rounded-[11px] bg-accent px-4 py-2 text-[13px] font-semibold text-[#08090A] disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar login"}
            </button>
            {saved && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-[11px] border border-border-strong px-4 py-2 text-[13px] font-semibold"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-2 rounded-[10px] border border-border-subtle bg-surface-chip px-3 py-2.5">
          <span className="h-2 w-2 flex-none rounded-full bg-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{saved!.usernameHint}</div>
            <div className="font-mono text-[10px] text-text-tertiary">conectado · {formatDateTime(saved!.updatedAt)}</div>
          </div>
          <button onClick={() => setEditing(true)} className="text-[11px] font-semibold text-accent">
            trocar
          </button>
          <button onClick={onRemove} className="text-[11px] font-semibold text-live">
            remover
          </button>
        </div>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-2 text-[13px] font-bold">Chave da extensão</div>
        {newKey ? (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-text-secondary">
              Cole no popup da extensão. <b>Ela só aparece agora</b> — se perder, gere outra.
            </p>
            <code className="break-all rounded-[10px] bg-surface-chip px-3 py-2 font-mono text-[11.5px]">{newKey}</code>
            <button
              onClick={() => navigator.clipboard.writeText(newKey).then(() => setCopied(true))}
              className="self-start rounded-[11px] border border-border-strong px-3 py-1.5 text-[12px] font-semibold"
            >
              {copied ? "Copiada ✓" : "Copiar"}
            </button>
          </div>
        ) : extensionKey ? (
          <p className="text-[12px] text-text-tertiary">
            Ativa desde {formatDateTime(extensionKey.createdAt)}
            {extensionKey.lastUsedAt ? ` · último uso ${formatDateTime(extensionKey.lastUsedAt)}` : " · ainda não usada"}
          </p>
        ) : (
          <p className="text-[12px] text-text-tertiary">Nenhuma chave — a extensão não consegue entrar.</p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            onClick={onCreateKey}
            className="rounded-[11px] border border-border-strong px-3 py-1.5 text-[12px] font-semibold"
          >
            {extensionKey ? "Gerar nova chave" : "Gerar chave"}
          </button>
          {extensionKey && (
            <button onClick={onRevokeKey} className="rounded-[11px] px-3 py-1.5 text-[12px] font-semibold text-live">
              Revogar
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-[12px] text-live">{error}</p>}
    </div>
  );
}
