// Calendar-date helpers shared by the screens that filter by day (Jogos, Jogo,
// EV+). The rule they all follow: work on the YYYY-MM-DD string itself and
// take "today" in America/Sao_Paulo — never `new Date().toISOString()`. That is
// the UTC date, which has already rolled into tomorrow for anyone in Brazil
// (UTC-3) after ~21h local time, so "Hoje" showed tomorrow's games, the EV+
// window started a day late, and so on.

/** Today's date in America/Sao_Paulo, as yyyy-mm-dd. */
export function todayIsoSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** `iso` (yyyy-mm-dd) shifted by `days` calendar days. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  // An empty/garbled date (an <input type="date"> can be cleared) makes `dt`
  // invalid, and toISOString() on an invalid Date throws — during render, which
  // blanked the whole page. Hand the input back untouched instead.
  if (Number.isNaN(dt.getTime())) return iso;
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
