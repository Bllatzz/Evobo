import { useEffect } from "react";
import { matchPath, useLocation } from "react-router-dom";

/** Ordered most-specific-first so overlapping patterns (e.g. `/tip/:tipId` vs
 * `/tip/:tipId/analise-ia`) resolve to the right label. */
const ROUTE_TITLES: { pattern: string; label: string }[] = [
  { pattern: "/entrar", label: "Entrar" },
  { pattern: "/criar-conta", label: "Criar conta" },
  { pattern: "/esqueci-senha", label: "Esqueci a senha" },
  { pattern: "/redefinir-senha", label: "Redefinir senha" },
  { pattern: "/", label: "Home" },
  { pattern: "/ao-vivo", label: "Ao Vivo" },
  { pattern: "/ranking", label: "Ranking" },
  { pattern: "/perfil/editar", label: "Editar perfil" },
  { pattern: "/perfil", label: "Meu perfil" },
  { pattern: "/jogos", label: "Jogos" },
  { pattern: "/ev", label: "EV+" },
  { pattern: "/busca", label: "Busca" },
  { pattern: "/tip/:tipId/analise-ia", label: "Análise IA" },
  { pattern: "/tip/:tipId", label: "Tip" },
  { pattern: "/vip/:groupId/checkout", label: "Checkout" },
  { pattern: "/vip/:groupId", label: "Grupo VIP" },
  { pattern: "/u/:username", label: "Perfil" },
  { pattern: "/nova-tip", label: "Nova tip" },
  { pattern: "/robo/mercado/:groupKey", label: "Gráfico do robô" },
  { pattern: "/robo/historico", label: "Histórico do robô" },
  { pattern: "/robo", label: "Robô de apostas" },
  { pattern: "/admin/roles", label: "Admin · Roles" },
  { pattern: "/admin/pagamentos", label: "Admin · Pagamentos" },
  { pattern: "/admin/telas", label: "Admin · Telas" },
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
