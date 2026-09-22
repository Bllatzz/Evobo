import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

/**
 * AES-256-GCM for secrets the API must be able to read back (bookmaker
 * logins — a hash wouldn't let the extension type the password in).
 * Format: "v1.<iv>.<tag>.<ciphertext>", all base64url. `context` is bound as
 * associated data (e.g. "userId:bookmaker:password"), so a ciphertext copied
 * into another row or field fails to decrypt instead of leaking.
 */
const VERSION = "v1";

function key(): Buffer {
  if (!env.CREDENTIALS_ENCRYPTION_KEY) throw new Error("CREDENTIALS_ENCRYPTION_KEY is not set");
  return Buffer.from(env.CREDENTIALS_ENCRYPTION_KEY, "base64");
}

export const secretBoxEnabled = () => !!env.CREDENTIALS_ENCRYPTION_KEY;

export function seal(plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function open(sealed: string, context: string): string {
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error("unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
