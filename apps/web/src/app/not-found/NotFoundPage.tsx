import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo } from "../../components/Logo";

/** Catch-all (`path="*"`) — any URL that matches none of the app's routes.
 * Public on purpose (no RouteGuard): a logged-out visitor can hit a dead link
 * too, and "/" already sends them to the login screen. */
export function NotFoundPage() {
  const { pathname } = useLocation();

  // DocumentTitle (mounted above the routes) falls back to a bare "Evobo" for
  // paths it doesn't know — and re-runs on every navigation — so set the title
  // here on the same trigger; this effect runs after that one.
  useEffect(() => {
    document.title = "Evobo | Página não encontrada";
  }, [pathname]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-text">
      <Logo size={64} rounded={19} className="mb-3 shadow-[0_12px_34px_rgba(43,224,138,.45)]" />

      <h1 className="text-2xl font-bold">Página não encontrada</h1>
      <p className="max-w-[320px] text-[14px] leading-relaxed text-text-secondary">
        O endereço que você abriu não existe ou foi movido.
      </p>

      <Link
        to="/"
        className="mt-3 flex h-11 items-center justify-center rounded-[13px] bg-accent px-6 text-[14px] font-semibold text-[#08090A]"
      >
        Voltar para o início
      </Link>
    </main>
  );
}
