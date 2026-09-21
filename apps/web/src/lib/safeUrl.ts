/**
 * The URL if it is an absolute http(s) URL, otherwise null.
 *
 * Every link that comes from data (a tip's bet link, a Telegram message, an
 * upstream feed) goes through this before reaching an `<a href>` or
 * `window.open`. `javascript:` and `data:` URLs would otherwise run script in
 * the app's origin when clicked — and the session token lives in localStorage.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
