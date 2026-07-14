import type { ScreenKey } from "@evobo/shared-types";

/**
 * Maps each product screen to its route path and label. This is the single
 * place that ties a route to the role_screen_access.screen_key the backend
 * checks — routes.tsx guards every entry here against the user's role.
 */
export const screenRoutes: Record<ScreenKey, { path: string; label: string }> = {
  feed: { path: "/", label: "Feed" },
  ao_vivo: { path: "/live", label: "Ao Vivo" },
  ev_plus: { path: "/ev", label: "EV+" },
  ranking: { path: "/ranking", label: "Ranking" },
  jogos: { path: "/games", label: "Jogos" },
  busca: { path: "/search", label: "Busca" },
  tip_aberta: { path: "/tip/:tipId", label: "Tip" },
  analise_ia: { path: "/tip/:tipId/ai-analysis", label: "Análise IA" },
  grupo_vip: { path: "/vip/:groupId", label: "Grupo VIP" },
  checkout: { path: "/vip/:groupId/checkout", label: "Checkout" },
  meu_perfil: { path: "/profile", label: "Meu Perfil" },
  perfil: { path: "/u/:username", label: "Perfil" },
  nova_tip: { path: "/new-tip", label: "Nova Tip" },
  robo_apostas: { path: "/robot", label: "Robô de Apostas" },
  admin: { path: "/admin", label: "Admin" },
  admin_roles: { path: "/admin/roles", label: "Gestão de Roles" },
  admin_payments: { path: "/admin/payments", label: "Aprovação de Pagamentos" },
  admin_screens: { path: "/admin/screens", label: "Telas & Permissões" },
};
