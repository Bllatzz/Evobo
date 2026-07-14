import { useEffect } from "react";
import { matchPath, useLocation } from "react-router-dom";

/** Ordered most-specific-first so overlapping patterns (e.g. `/tip/:tipId` vs
 * `/tip/:tipId/ai-analysis`) resolve to the right label. */
const ROUTE_TITLES: { pattern: string; label: string }[] = [
  { pattern: "/login", label: "Entrar" },
  { pattern: "/register", label: "Criar conta" },
  { pattern: "/forgot-password", label: "Esqueci a senha" },
  { pattern: "/reset-password", label: "Redefinir senha" },
  { pattern: "/", label: "Home" },
  { pattern: "/live", label: "Ao Vivo" },
  { pattern: "/ranking", label: "Ranking" },
  { pattern: "/profile/edit", label: "Editar perfil" },
  { pattern: "/profile", label: "Meu perfil" },
  { pattern: "/games", label: "Jogos" },
  { pattern: "/ev", label: "EV+" },
  { pattern: "/search", label: "Busca" },
  { pattern: "/tip/:tipId/ai-analysis", label: "Análise IA" },
  { pattern: "/tip/:tipId", label: "Tip" },
  { pattern: "/vip/:groupId/checkout", label: "Checkout" },
  { pattern: "/vip/:groupId", label: "Grupo VIP" },
  { pattern: "/u/:username", label: "Perfil" },
  { pattern: "/new-tip", label: "Nova tip" },
  { pattern: "/robot/market/:groupKey", label: "Gráfico do robô" },
  { pattern: "/robot/history", label: "Histórico do robô" },
  { pattern: "/robot", label: "Robô de apostas" },
  { pattern: "/admin/roles", label: "Admin · Roles" },
  { pattern: "/admin/payments", label: "Admin · Pagamentos" },
  { pattern: "/admin/screens", label: "Admin · Telas" },
  { pattern: "/admin", label: "Admin" },
];

/** Sets `document.title` to "Evobo | <Página>" on every route change. Mounted
 * once inside the router so it has access to the current location. */
export function DocumentTitle() {
  const location = useLocation();

  useEffect(() => {
    const match = ROUTE_TITLES.find(({ pattern }) =>
      matchPath({ path: pattern, end: true }, location.pathname),
    );
    document.title = match ? `Evobo | ${match.label}` : "Evobo";
  }, [location.pathname]);

  return null;
}
