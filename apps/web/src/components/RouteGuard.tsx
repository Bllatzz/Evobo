import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { ScreenKey } from "@evobo/shared-types";
import { useAuth } from "../stores/auth";
import { Logo } from "./Logo";

function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-text">
      {children}
    </div>
  );
}

/**
 * Frontend half of the two-layer authorization check (spec requires both):
 * this hides screens the role can't see; the backend re-checks the same
 * role_screen_access row on every request regardless of what this renders.
 */
export function RouteGuard({ screen, children }: { screen: ScreenKey; children: ReactNode }) {
  const { loading, isAuthenticated, connectionError, retryConnection, canAccess } = useAuth();

  if (loading) {
    return (
      <FullScreenMessage>
        <div className="animate-pulse">
          <Logo />
        </div>
      </FullScreenMessage>
    );
  }
  // Logged in, but the API didn't answer (restarting/offline) — never send a
  // valid session to /login over that.
  if (connectionError) {
    return (
      <FullScreenMessage>
        <Logo />
        <p className="max-w-xs text-[14px] text-text-secondary">
          Não conseguimos falar com o servidor agora. Sua sessão continua ativa.
        </p>
        <button
          onClick={retryConnection}
          className="rounded-[11px] bg-accent px-4 py-2 text-[13px] font-semibold text-[#08090A]"
        >
          Tentar de novo
        </button>
      </FullScreenMessage>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!canAccess(screen)) return <Navigate to="/" replace />;

  return <>{children}</>;
}
