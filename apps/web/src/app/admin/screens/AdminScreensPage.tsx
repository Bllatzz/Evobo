import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ScreenKey } from "@evobo/shared-types";
import { fetchRoles, fetchRole, updateRoleScreenAccess, type RoleDetail } from "../../../lib/admin";
import { screenRoutes } from "../../../lib/screens";
import {
  IconHome,
  IconLive,
  IconRobotMonitor,
  IconRanking,
  IconCalendar,
  IconSearch,
  IconTrendingUp,
  IconTune,
  IconTrophy,
  IconChevronLeft,
} from "../../../components/Icon";

/**
 * End-user-facing screens a regular platform user could plausibly see —
 * excludes admin_* and detail routes reached by navigation (tip_aberta,
 * perfil, nova_tip, checkout) rather than a tab/menu entry point.
 */
const TOGGLEABLE_SCREENS: { key: ScreenKey; Icon: typeof IconHome }[] = [
  { key: "feed", Icon: IconHome },
  { key: "ao_vivo", Icon: IconLive },
  { key: "robo_apostas", Icon: IconRobotMonitor },
  { key: "ranking", Icon: IconRanking },
  { key: "jogos", Icon: IconCalendar },
  { key: "busca", Icon: IconSearch },
  { key: "ev_plus", Icon: IconTrendingUp },
  { key: "analise_ia", Icon: IconTune },
  { key: "grupo_vip", Icon: IconTrophy },
];

type Tier = "free" | "vip";

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      aria-pressed={on}
      className={`flex h-[27px] w-[46px] flex-none items-center rounded-full px-[3px] transition-colors ${
        on ? "justify-end bg-accent" : "justify-start bg-surface-alt"
      }`}
    >
      <span className={`h-[21px] w-[21px] rounded-full ${on ? "bg-[#08090A]" : "bg-text-quaternary"}`} />
    </button>
  );
}

export function AdminScreensPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState<RoleDetail | null>(null);
  const [freeSet, setFreeSet] = useState<Set<ScreenKey>>(new Set());
  const [vipSet, setVipSet] = useState<Set<ScreenKey>>(new Set());
  const [tab, setTab] = useState<Tier>("vip");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    const roles = await fetchRoles();
    const userRole = roles.find((r) => r.name === "user");
    if (!userRole) {
      setLoadError(true);
      return;
    }
    const detail = await fetchRole(userRole.id);
    setRole(detail);
    setFreeSet(new Set(detail.screensByTier.free));
    setVipSet(new Set(detail.screensByTier.vip));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Free tier and VIP tier are mutually exclusive per screen — a screen is
  // either free-for-everyone, gated behind an active VIP subscription, or
  // not enabled at all for the "user" role.
  function toggle(key: ScreenKey) {
    if (tab === "free") {
      setFreeSet((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setVipSet((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return;
    }
    // VIP tab: a screen already free is always visible to VIP subscribers
    // too — this tab only edits the "vip-exclusive" extra screens.
    if (freeSet.has(key)) return;
    setVipSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const isOn = useMemo(
    () => (key: ScreenKey) => (tab === "free" ? freeSet.has(key) : freeSet.has(key) || vipSet.has(key)),
    [tab, freeSet, vipSet],
  );

  async function handleSave() {
    if (!role) return;
    setSaving(true);
    setError(null);
    try {
      await Promise.all([
        updateRoleScreenAccess(role.id, [...freeSet], "free"),
        updateRoleScreenAccess(role.id, [...vipSet], "vip"),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar permissões");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-dvh bg-bg pb-28 text-text lg:mx-auto lg:max-w-[760px] lg:px-8 lg:pb-16 lg:pt-8">
      <div className="flex items-center gap-3 px-4 pb-3.5 pt-14 lg:px-0 lg:pt-0">
        <button onClick={() => navigate(-1)} className="text-text lg:hidden" aria-label="Voltar">
          <IconChevronLeft size={22} />
        </button>
        <div className="flex-1">
          <div className="text-[20px] font-bold tracking-[-0.02em] lg:text-[22px]">
            Telas &amp; permissões
          </div>
          <div className="font-mono text-[11px] text-text-tertiary">Controle o que o usuário vê</div>
        </div>
        <TierPicker tab={tab} setTab={setTab} className="hidden lg:flex" />
      </div>

      <TierPicker tab={tab} setTab={setTab} className="mx-4 mb-3.5 flex lg:hidden" labeled />

      {loadError && (
        <p className="mx-4 mb-3.5 rounded-xl border border-live/40 bg-live/10 px-3.5 py-2.5 text-[12.5px] text-live lg:mx-0">
          Role "user" não encontrado — verifique o seed de roles.
        </p>
      )}

      <div className="px-4 pb-2 pt-2 font-mono text-[11px] tracking-[0.1em] text-text-tertiary lg:px-0">
        TELAS DO APP
      </div>
      <div className="flex flex-col gap-2 px-4 lg:px-0">
        {TOGGLEABLE_SCREENS.map(({ key, Icon }) => {
          const on = isOn(key);
          const isVipTagged = vipSet.has(key);
          return (
            <div
              key={key}
              className={`flex items-center justify-between rounded-2xl border p-3.5 ${
                on ? "border-accent-border bg-surface" : "border-border bg-surface"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] ${
                    on ? "bg-accent-soft" : "bg-surface-alt"
                  }`}
                >
                  <Icon size={17} className={on ? "text-accent" : "text-text-secondary"} />
                </div>
                <div>
                  <div className="text-[14.5px] font-semibold">{screenRoutes[key].label}</div>
                  {isVipTagged && (
                    <div className={`font-mono text-[10.5px] ${on ? "text-accent" : "text-text-tertiary"}`}>
                      exclusivo VIP
                    </div>
                  )}
                </div>
              </div>
              <Toggle on={on} onChange={() => toggle(key)} />
            </div>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-bg to-transparent px-4 pb-6 pt-8 lg:static lg:mt-6 lg:bg-none lg:px-0 lg:pb-0 lg:pt-0">
        {error && <p className="mb-3 text-[12.5px] text-live lg:max-w-[280px]">{error}</p>}
        <button
          onClick={handleSave}
          disabled={saving || !role}
          className="h-[50px] w-full rounded-2xl bg-accent text-[15px] font-bold text-[#08090A] disabled:opacity-60 lg:max-w-[280px]"
        >
          {saving ? "Salvando…" : "Salvar permissões"}
        </button>
      </div>
    </div>
  );
}

function TierPicker({
  tab,
  setTab,
  className,
  labeled,
}: {
  tab: Tier;
  setTab: (t: Tier) => void;
  className: string;
  labeled?: boolean;
}) {
  return (
    <div
      className={`${className} items-center justify-between rounded-2xl border border-border bg-surface px-3.5 py-3 lg:justify-start lg:border-0 lg:bg-transparent lg:p-0`}
    >
      {labeled && <span className="font-mono text-xs text-text-secondary">PLANO APLICADO</span>}
      <div className="flex gap-1.5 font-mono text-[11px]">
        <button
          onClick={() => setTab("free")}
          className={`rounded-lg px-2.5 py-1 ${tab === "free" ? "bg-accent font-bold text-[#08090A]" : "text-text-tertiary"}`}
        >
          Free
        </button>
        <button
          onClick={() => setTab("vip")}
          className={`rounded-lg px-2.5 py-1 ${tab === "vip" ? "bg-accent font-bold text-[#08090A]" : "text-text-tertiary"}`}
        >
          VIP
        </button>
      </div>
    </div>
  );
}
