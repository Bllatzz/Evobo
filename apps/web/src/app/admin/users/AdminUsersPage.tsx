import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  assignRole,
  fetchAdminUsers,
  fetchRoles,
  setUserActive,
  type AdminUser,
  type RoleSummary,
} from "../../../lib/admin";
import { useAuth } from "../../../stores/auth";
import { Avatar } from "../../../components/Avatar";
import { IconChevronLeft } from "../../../components/Icon";

const PAGE_SIZE = 30;

function UserRow({
  user,
  roles,
  isSelf,
  onChanged,
}: {
  user: AdminUser;
  roles: RoleSummary[];
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [savingRole, setSavingRole] = useState(false);
  const [savingActive, setSavingActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRoleChange(roleId: string) {
    if (!roleId || roleId === user.role.id) return;
    const roleName = roles.find((r) => r.id === roleId)?.name ?? roleId;
    if (!confirm(`Atribuir o role "${roleName}" a @${user.username}?`)) return;
    setSavingRole(true);
    setError(null);
    try {
      await assignRole(user.id, roleId);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atribuir role");
    } finally {
      setSavingRole(false);
    }
  }

  async function handleToggleActive() {
    const next = !user.isActive;
    if (!confirm(next ? `Reativar @${user.username}?` : `Suspender @${user.username}? A conta perde acesso ao app.`)) return;
    setSavingActive(true);
    setError(null);
    try {
      await setUserActive(user.id, next);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar status");
    } finally {
      setSavingActive(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border-subtle px-4 py-3 last:border-b-0 lg:flex-row lg:items-center lg:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={user.displayName} seed={user.id} src={user.avatarUrl} size={36} />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold">
            {user.displayName}
            {isSelf && <span className="ml-1.5 text-[11px] text-text-tertiary">(você)</span>}
          </div>
          <div className="truncate font-mono text-[11.5px] text-text-tertiary">@{user.username}</div>
        </div>
        {!user.isActive && (
          <span className="flex-none rounded-full border border-live/40 bg-live/10 px-2 py-0.5 text-[10px] font-semibold text-live">
            suspenso
          </span>
        )}
      </div>

      <div className="flex flex-none items-center gap-2">
        <select
          value={user.role.id}
          onChange={(e) => handleRoleChange(e.target.value)}
          disabled={savingRole}
          className="rounded-lg border border-border-strong bg-surface-alt px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-accent disabled:opacity-60"
        >
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleToggleActive}
          disabled={savingActive || isSelf}
          title={isSelf ? "Você não pode suspender sua própria conta" : undefined}
          className={`flex-none rounded-lg border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40 ${
            user.isActive ? "border-live/40 text-live" : "border-accent-border text-accent"
          }`}
        >
          {savingActive ? "…" : user.isActive ? "Suspender" : "Reativar"}
        </button>
      </div>

      {error && <p className="text-[11.5px] text-live lg:basis-full">{error}</p>}
    </div>
  );
}

export function AdminUsersPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ data: AdminUser[]; total: number; totalPages: number } | null>(null);

  const load = useCallback(() => {
    fetchAdminUsers({ page, limit: PAGE_SIZE, q: query.trim() || undefined }).then(setResult);
  }, [page, query]);

  useEffect(() => {
    fetchRoles().then(setRoles);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const body = (
    <div className="rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 p-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por username ou nome…"
          className="w-full max-w-xs rounded-lg border border-border-strong bg-surface-alt px-3 py-2 text-[13.5px] text-text outline-none focus:border-accent"
        />
        <span className="flex-none font-mono text-[12px] text-text-tertiary">
          {result ? `${result.total} usuário(s)` : "…"}
        </span>
      </div>

      <div className="border-t border-border">
        {result === null && <p className="py-8 text-center text-[12.5px] text-text-tertiary">Carregando…</p>}
        {result?.data.length === 0 && (
          <p className="py-8 text-center text-[12.5px] text-text-tertiary">Nenhum usuário encontrado.</p>
        )}
        {result?.data.map((u) => (
          <UserRow key={u.id} user={u} roles={roles} isSelf={u.id === me?.id} onChanged={load} />
        ))}
      </div>

      {result && result.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-[12.5px] disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="font-mono text-[12px] text-text-tertiary">
            página {page} de {result.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(result.totalPages, p + 1))}
            disabled={page >= result.totalPages}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-[12.5px] disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh bg-bg text-text lg:flex lg:min-h-full lg:flex-col">
      {/* ---------- Desktop ---------- */}
      <div className="hidden lg:flex lg:h-[70px] lg:flex-none lg:items-center lg:gap-3 lg:border-b lg:border-border lg:px-8">
        <Link to="/admin" className="text-[13px] text-text-tertiary hover:text-text">
          Admin
        </Link>
        <span className="text-text-tertiary">/</span>
        <span className="text-[20px] font-bold tracking-[-0.02em]">Usuários</span>
      </div>

      <div className="hidden lg:block lg:flex-1 lg:overflow-y-auto lg:px-8 lg:py-6">{body}</div>

      {/* ---------- Mobile ---------- */}
      <div className="pb-8 lg:hidden">
        <div className="flex items-center gap-3.5 border-b border-border px-4 pb-3.5 pt-14">
          <button onClick={() => navigate(-1)} aria-label="Voltar">
            <IconChevronLeft size={22} />
          </button>
          <span className="text-[16px] font-semibold">Usuários</span>
        </div>
        <div className="p-4">{body}</div>
      </div>
    </div>
  );
}
