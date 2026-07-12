import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  REDIS_URL: z.string().min(1),

  PIX_KEY: z.string().min(1),
  PIX_RECEIVER_NAME: z.string().min(1),
  PIX_RECEIVER_CITY: z.string().min(1),

  // Neo IA (robotip.com.br) requires login + is capped at 6 AI credits/day
  // on the free tier — not wired up yet, see src/modules/neoia-scraper.
  NEOIA_EMAIL: z.string().email().optional(),
  NEOIA_PASSWORD: z.string().min(1).optional(),

  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CORS_ORIGIN: z.string().min(1),
});

/** Fail fast on boot rather than surface a confusing error deep in a request handler. */
export const env = EnvSchema.parse(process.env);
export type Env = typeof env;
