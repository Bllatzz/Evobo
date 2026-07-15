import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { screenKeys, type ScreenKey } from "@evobo/shared-types";
import {
  assignRole,
  createRole,
  deleteRole,
  fetchRole,
  fetchRoles,
  searchUsersForRole,
  updateRole,
  updateRoleScreenAccess,
  type RoleDetail,
  type RoleSummary,
  type UserSearchResult,
} from "../../../lib/admin";
import { screenRoutes } from "../../../lib/screens";

function RoleEditor({
  role,
  onClose,
  onSaved,
}: {
  role: RoleDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(role.description ?? "");
  const [screens, setScreens] = useState<Set<ScreenKey>>(new Set(role.screens));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleScreen(key: ScreenKey) {
    setScreens((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    // This checklist includes admin_* screens too — for a system role
    // (esp. "admin") saving here can lock every admin out of their own
    // tools, or hand admin access to a role that shouldn't have it.
    if (
      role.isSystem &&
      !confirm(
        `"${role.name}" é um role do sistema. Salvar aqui altera quais telas ele acessa — inclusive telas administrativas. Continuar?`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await Promise.all([
        updateRole(role.id, { description }),
        updateRoleScreenAccess(role.id, [...screens]),
      ]);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Excluir o role "${role.name}"?`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteRole(role.id);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir");
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[14px] font-semibold">{role.name}</div>
        {role.isSystem && (
          <span className="rounded-md bg-surface-alt px-2 py-0.5 text-[10px] text-text-tertiary">
            role do sistema
          </span>
        )}
      </div>

      <label className="mb-4 block">
        <span className="mb-1.5 block font-mono text-[11px] text-text-tertiary">DESCRIÇÃO</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-lg border border-border-strong bg-surface-alt px-3 py-2 text-[13.5px] text-text outline-none focus:border-accent"
        />
      </label>

      <div className="mb-1.5 font-mono text-[11px] text-text-tertiary">TELAS PERMITIDAS</div>
      <div className="mb-4 grid grid-cols-2 gap-1.5">
        {screenKeys.map((key) => (
          <label key={key} className="flex items-center gap-2 rounded-lg bg-surface-alt px-2.5 py-2">
            <input
              type="checkbox"
              checked={screens.has(key)}
              onChange={() => toggleScreen(key)}
              className="accent-accent"
            />
            <span className="text-[12.5px]">{screenRoutes[key].label}</span>
          </label>
        ))}
      </div>

      {error && <p className="mb-3 text-[12.5px] text-live">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || deleting}
          className="flex-1 rounded-xl bg-accent py-2.5 text-[13.5px] font-semibold text-[#08090A] disabled:opacity-60"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
        <button
          onClick={onClose}
          disabled={saving || deleting}
          className="rounded-xl border border-border-strong px-4 text-[13.5px] disabled:opacity-60"
        >
          Fechar
        </button>
        {!role.isSystem && (
          <button
            onClick={handleDelete}
            disabled={saving || deleting}
            className="rounded-xl border border-live/40 px-4 text-[13.5px] text-live disabled:opacity-60"
          >
            {deleting ? "Excluindo…" : "Excluir"}
          </button>
        )}
      </div>
    </div>
  );
}

function AssignRolePanel({ roles, onAssigned }: { roles: RoleSummary[]; onAssigned: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      searchUsersForRole(query.trim()).then((r) => {
        if (!cancelled) setResults(r);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  async function handleAssign() {
    if (!selectedUser || !selectedRoleId) return;
    // Assigning a role — potentially "admin" — takes effect with a single
    // click today; this is the only guard against a misclick or a wrong
    // search result being selected.
    const roleName = roles.find((r) => r.id === selectedRoleId)?.name ?? selectedRoleId;
    if (!confirm(`Atribuir o role "${roleName}" a @${selectedUser.username}?`)) return;

    setAssigning(true);
    setError(null);
    try {
      await assignRole(selectedUser.id, selectedRoleId);
      setSelectedUser(null);
      setQuery("");
      setSelectedRoleId("");
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atribuir role");
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">
        ATRIBUIR ROLE A UM USUÁRIO
      </div>

      {selectedUser ? (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-surface-alt px-3 py-2">
          <span className="text-[13.5px]">
            {selectedUser.displayName} <span className="text-text-tertiary">@{selectedUser.username}</span>
          </span>
          <button onClick={() => setSelectedUser(null)} className="text-[12px] text-text-tertiary">
            trocar
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por username ou nome…"
            className="mb-2 w-full rounded-lg border border-border-strong bg-surface-alt px-3 py-2 text-[13.5px] text-text outline-none focus:border-accent"
          />
          {results.length > 0 && (
            <div className="mb-3 flex flex-col gap-1">
              {results.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setSelectedUser(u)}
                  className="rounded-lg bg-surface-alt px-3 py-2 text-left text-[13px]"
                >
                  {u.displayName} <span className="text-text-tertiary">@{u.username} · {u.role.name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <select
        value={selectedRoleId}
        onChange={(e) => setSelectedRoleId(e.target.value)}
        className="mb-3 w-full rounded-lg border border-border-strong bg-surface-alt px-3 py-2 text-[13.5px] text-text"
      >
        <option value="">Selecione o novo role…</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>

      {error && <p className="mb-3 text-[12.5px] text-live">{error}</p>}

      <button
        onClick={handleAssign}
        disabled={!selectedUser || !selectedRoleId || assigning}
        className="w-full rounded-xl bg-accent py-2.5 text-[13.5px] font-semibold text-[#08090A] disabled:opacity-40"
      >
        {assigning ? "Atribuindo…" : "Atribuir"}
      </button>
    </div>
  );
}

export function AdminRolesPage() {
  const navigate = useNavigate();
  const [roles, setRoles] = useState<RoleSummary[] | null>(null);
  const [editingRole, setEditingRole] = useState<RoleDetail | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchRoles().then(setRoles);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newRoleName.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createRole({ name: newRoleName.trim(), description: newRoleDesc.trim() || undefined });
      setNewRoleName("");
      setNewRoleDesc("");
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Falha ao criar role");
    } finally {
      setCreating(false);
    }
  }

  async function openEditor(roleId: string) {
    setEditingRole(await fetchRole(roleId));
  }

  const editorBlock = editingRole && (
    <RoleEditor
      role={editingRole}
      onClose={() => setEditingRole(null)}
      onSaved={() => {
        setEditingRole(null);
        load();
      }}
    />
  );

  const rolesCard = (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 font-mono text-[11px] tracking-[0.06em] text-text-tertiary">ROLES</div>
      <div className="flex flex-col gap-1.5">
        {roles === null && <p className="py-4 text-center text-[12.5px] text-text-tertiary">Carregando…</p>}
        {roles?.length === 0 && (
          <p className="py-4 text-center text-[12.5px] text-text-tertiary">Nenhum role encontrado.</p>
        )}
        {roles?.map((r) => (
          <button
            key={r.id}
            onClick={() => openEditor(r.id)}
            className="flex items-center justify-between rounded-lg bg-surface-alt px-3 py-2.5 text-left"
          >
            <div>
              <div className="text-[13.5px] font-semibold">{r.name}</div>
              {r.description && <div className="text-[11.5px] text-text-tertiary">{r.description}</div>}
            </div>
            <span className="font-mono text-[12px] text-text-tertiary">{r.userCount} usuários</span>
          </button>
        ))}
      </div>

      <form onSubmit={handleCreate} className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
        <input
          value={newRoleName}
          onChange={(e) => setNewRoleName(e.target.value)}
          placeholder="nome_do_role (ex: tester)"
          className="rounded-lg border border-border-strong bg-surface-alt px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
        />
        <input
          value={newRoleDesc}
          onChange={(e) => setNewRoleDesc(e.target.value)}
          placeholder="Descrição (opcional)"
          className="rounded-lg border border-border-strong bg-surface-alt px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
        />
        {createError && <p className="text-[12px] text-live">{createError}</p>}
        <button
          type="submit"
          disabled={!newRoleName.trim() || creating}
          className="rounded-lg bg-accent py-2 text-[13px] font-semibold text-[#08090A] disabled:opacity-40"
        >
          {creating ? "Criando…" : "+ Novo role"}
        </button>
      </form>
    </div>
  );

  const assignPanel = roles && <AssignRolePanel roles={roles} onAssigned={load} />;

  return (
    <div className="min-h-dvh bg-bg text-text lg:flex lg:min-h-full lg:flex-col">
      {/* ---------- Desktop ---------- */}
      <div className="hidden lg:flex lg:h-[70px] lg:flex-none lg:items-center lg:gap-3 lg:border-b lg:border-border lg:px-8">
        <Link to="/admin" className="text-[13px] text-text-tertiary hover:text-text">
          Admin
        </Link>
        <span className="text-text-tertiary">/</span>
        <span className="text-[20px] font-bold tracking-[-0.02em]">Gestão de Roles</span>
      </div>

      <div className="hidden lg:block lg:flex-1 lg:overflow-y-auto lg:px-8 lg:py-6">
        <div className="grid grid-cols-2 items-start gap-4">
          <div className="flex flex-col gap-4">
            {editorBlock}
            {rolesCard}
          </div>
          {assignPanel}
        </div>
      </div>

      {/* ---------- Mobile ---------- */}
      <div className="pb-8 lg:hidden">
        <div className="flex items-center gap-3.5 border-b border-border px-4 pb-3.5 pt-14">
          <button onClick={() => navigate(-1)} className="text-2xl leading-none" aria-label="Voltar">
            ‹
          </button>
          <span className="text-[16px] font-semibold">Gestão de Roles</span>
        </div>

        <div className="flex flex-col gap-3 p-4">
          {editorBlock}
          {rolesCard}
          {assignPanel}
        </div>
      </div>
    </div>
  );
}
