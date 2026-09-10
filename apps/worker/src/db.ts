import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

/** Same schema/database apps/api uses — the generated client is hoisted to the repo-root node_modules by npm workspaces, so this is the exact same client, not a second copy. */
export const prisma = new PrismaClient();

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see .env.example)`);
  return value;
}

/** service_role client — only used to upload bet-slip photos to Storage. Never exposed to Telegram or any client. */
export const supabaseAdmin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const PHOTO_BUCKET = "telegram-tip-photos";
