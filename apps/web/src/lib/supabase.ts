import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/** Owns the auth session lifecycle client-side (signup/login/OAuth/refresh) — see project memory on the Supabase Auth decision. */
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
