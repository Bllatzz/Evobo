import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

/**
 * service_role client — bypasses RLS entirely. Only ever used from backend
 * code (Storage signed URLs for payment proofs, Supabase Auth admin API for
 * role/MFA management). Never send this key or a client built from it to
 * the frontend.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
