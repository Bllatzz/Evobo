/** Minimum score required to submit — "boa" is the same bar the Supabase
 * project enforces server-side (min 8 chars, at least one letter and one
 * digit — see `password_requirements` in supabase/config.toml), so nothing
 * that clears this client-side check can come back as a weak-password error. */
export const MIN_SCORE_TO_SUBMIT = 2;

export const STRENGTH_LEVELS = [
  { label: "fraca", className: "text-live" },
  { label: "média", className: "text-vip" },
  { label: "boa", className: "text-accent-strong" },
  { label: "forte", className: "text-accent" },
] as const;

export function passwordStrength(password: string): { score: number; label: string; className: string } {
  // Spread iterates by code point, not UTF-16 unit — an emoji/surrogate-pair
  // password like "aA1😀😀😀😀" is 7 visible characters, not the 11 that
  // `.length` would report, so `.length >= 8` would wrongly let it through.
  const longEnough = [...password].length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const meetsMinimum = longEnough && hasLetter && hasDigit;

  let score: number;
  if (!longEnough) {
    score = 0;
  } else if (!meetsMinimum) {
    score = 1;
  } else if (/[a-z]/.test(password) && /[A-Z]/.test(password) && /[^a-zA-Z0-9]/.test(password)) {
    score = 3;
  } else {
    score = 2;
  }

  return { score, ...STRENGTH_LEVELS[score] };
}
