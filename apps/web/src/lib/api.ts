import { supabase } from "./supabase";
import { env } from "./env";

/** Thrown by apiFetch — carries the HTTP status so callers (esp. the auth
 * store) can tell "the token is really invalid" (401/403) apart from a
 * transient network/server failure, instead of treating every failure as
 * a sign-out. */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Calls our Fastify backend with the current Supabase session's access token — authGuard on the other end re-verifies it, never trusts this call alone. */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(init.headers);
  if (session) headers.set("Authorization", `Bearer ${session.access_token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.VITE_API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? `request_failed_${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}
