import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type { ScreenKey } from "@evobo/shared-types";
import { supabase } from "../lib/supabase";
import { apiFetch, ApiError } from "../lib/api";
import { retryTransient } from "../lib/retry";

/** 401/403 from the backend = the token was rejected (a real "logged out"),
 * as opposed to a network error or 5xx, which are worth retrying. */
const isAuthFailure = (err: unknown): boolean =>
  err instanceof ApiError && (err.status === 401 || err.status === 403);

/** Waits before each /auth/me retry: covers a few seconds of API restart. */
const ME_RETRY_DELAYS_MS = [1000, 2000];

type Me = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  favoriteSports: string[];
  role: string;
  verifiedAt: string | null;
  hasActiveVip: boolean;
  accessibleScreens: ScreenKey[];
};

type AuthContextValue = {
  loading: boolean;
  session: Session | null;
  me: Me | null;
  isAuthenticated: boolean;
  canAccess: (screen: ScreenKey) => boolean;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  // `session` starts as null before the initial `getSession()` (which reads
  // localStorage) resolves — without this flag, the effect below sees that
  // placeholder null, concludes "logged out" and flips `loading` false
  // before the real session loads, bouncing every reload to /login.
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionChecked(true);
    });

    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        setSessionChecked(true);
      })
      .catch(() => {
        // Reading the stored session failed: treat it as "no session" instead
        // of leaving sessionChecked false — that kept `loading` true and the
        // route guard on a blank screen forever.
        setSession(null);
        setSessionChecked(true);
      });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sessionChecked) return;
    let cancelled = false;

    async function loadMe() {
      if (!session) {
        setMe(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        // A network blip or a 5xx (e.g. opening the site while the API is
        // restarting for a deploy) is retried a couple of times while `loading`
        // stays true. On the first load `me` is still null, so giving up at
        // once made `isAuthenticated` false and bounced a valid session to
        // /login.
        const data = await retryTransient(
          () => apiFetch("/auth/me"),
          (err) => !isAuthFailure(err),
          ME_RETRY_DELAYS_MS,
          () => cancelled,
        );
        if (!cancelled) setMe(data);
      } catch (err) {
        // Only a real auth failure (401/403 — token rejected by the backend)
        // means "logged out". A network blip, timeout, or 5xx that outlasted
        // the retries must not wipe `me` — that would bounce a user with a
        // perfectly valid session back to /login over a transient error.
        if (!cancelled && isAuthFailure(err)) setMe(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMe();
    return () => {
      cancelled = true;
    };
    // Depende só do user id, não do objeto `session` inteiro: Supabase
    // dispara onAuthStateChange (TOKEN_REFRESHED) toda vez que a aba volta a
    // ficar visível, trocando a referência de `session` pro mesmo usuário —
    // se essa dependência fosse `session`, cada refresh de token reexecutava
    // isso, jogando `loading` pra true de novo e remontando a tela inteira
    // (RouteGuard mostra uma div em branco enquanto loading é true), como se
    // a página tivesse recarregado, perdendo o scroll. apiFetch já pega o
    // token atual direto do client do Supabase, não precisa desse efeito
    // rodar de novo só por causa do refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, sessionChecked]);

  const value: AuthContextValue = {
    loading,
    session,
    me,
    isAuthenticated: !!session && !!me,
    // Deny by default — mirrors the backend's roleGuard, which is the check
    // that actually matters. This one is just so the UI doesn't flash
    // screens the user can't use.
    canAccess: (screen) => !!me?.accessibleScreens.includes(screen),
    signOut: async () => {
      await supabase.auth.signOut();
    },
    // Re-fetches /auth/me without the sign-out round trip — used after
    // editing the profile so the new name/photo/bio show up immediately.
    refreshMe: async () => {
      if (!session) return;
      const data = await apiFetch("/auth/me");
      setMe(data);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
