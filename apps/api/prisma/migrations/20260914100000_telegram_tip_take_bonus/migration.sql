-- Bônus/turbinada em R$ pago por fora da odd (ex.: "Aposta Turbinada +50%"
-- da Betano, calculado sobre o lucro, não sobre a odd) — nunca entra no
-- casamento odd-a-odd do import, só soma no lucro em R$ quando existe
-- unitValue pra converter (ver aggregateBy/series em routes.ts).
alter table public.telegram_tip_takes
  add column bonus_reais numeric(8, 2);
