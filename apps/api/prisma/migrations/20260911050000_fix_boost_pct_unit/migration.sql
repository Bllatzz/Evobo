-- One-off data fix: a message with "1%" (real unit sizing) plus a later
-- "Só vale com aumento de 30%" commentary line got its unit read as 30
-- instead of 1 — the old PERCENTAGE_RE matched any "%" on any line, so the
-- last one found won. Fixed at the source in parseTip.ts (PERCENTAGE_LINE_RE
-- now requires the whole line to be just the percentage); this corrects the
-- one row already created under the old behavior.
update public.telegram_tips
set unit = 1
where bet_url = 'https://www.bet365.bet.br/s/r/ddlpr'
  and unit = 30;
