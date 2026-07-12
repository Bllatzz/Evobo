import type { ScreenKey } from "@evobo/shared-types";

/**
 * Maps each product screen to its route path and label. This is the single
 * place that ties a route to the role_screen_access.screen_key the backend
 * checks — routes.tsx guards every entry here against the user's role.
 */
export const screenRoutes: Record<ScreenKey, { path: string; label: string }> = {
  feed: { path: "/", label: "Feed" },
  ao_vivo: { path: "/ao-vivo", label: "Ao Vivo" },
  ev_plus: { path: "/ev", label: "EV+" },
  ranking: { path: "/ranking", label: "Ranking" },
  jogos: { path: "/jogos", label: "Jogos" },
  busca: { path: "/busca", label: "Busca" },
  tip_aberta: { path: "/tip/:tipId", label: "Tip" },
  analise_ia: { path: "/tip/:tipId/analise-ia", label: "Análise IA" },
  grupo_vip: { path: "/vip/:groupId", label: "Grupo VIP" },
  checkout: { path: "/vip/:groupId/checkout", label: "Checkout" },
  meu_perfil: { path: "/perfil", label: "Meu Perfil" },
  perfil: { path: "/u/:username", label: "Perfil" },
  nova_tip: { path: "/nova-tip", label: "Nova Tip" },
  robo_apostas: { path: "/robo", label: "Robô de Apostas" },
  admin: { path: "/admin", label: "Admin" },
  admin_roles: { path: "/admin/roles", label: "Gestão de Roles" },
  admin_payments: { path: "/admin/pagamentos", label: "Aprovação de Pagamentos" },
  admin_screens: { path: "/admin/telas", label: "Telas & Permissões" },
};
