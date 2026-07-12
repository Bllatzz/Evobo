-- Design's Tip card needs the bookmaker name ("Abrir na Betano ↗") and a
-- qualitative confidence label ("Confiança alta") — neither was in the
-- originally approved schema.
create type public.tip_confidence as enum ('baixa', 'media', 'alta');

alter table public.tips
  add column house text not null default 'Bet365',
  add column confidence public.tip_confidence;

alter table public.tips alter column house drop default;
