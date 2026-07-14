import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { ScreenKey } from "@evobo/shared-types";
import { useAuth } from "../stores/auth";

/**
 * Frontend half of the two-layer authorization check (spec requires both):
 * this hides screens the role can't see; the backend re-checks the same
 * role_screen_access row on every request regardless of what this renders.
 */
export function RouteGuard({ screen, children }: { screen: ScreenKey; children: ReactNode }) {
  const { loading, isAuthenticated, canAccess } = useAuth();

  if (loading) {
    return <div className="min-h-dvh bg-bg" />;
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!canAccess(screen)) return <Navigate to="/" replace />;

  return <>{children}</>;
}
