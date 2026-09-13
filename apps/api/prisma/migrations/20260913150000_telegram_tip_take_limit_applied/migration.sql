-- Marks a personal TelegramTipTake whose `unit` was auto-capped because the
-- requested stake, converted to R$ via that user's Banca unitValue, passed
-- the tip's own `limit` (R$) — see PATCH /telegram-tips/:id/take.
alter table public.telegram_tip_takes
  add column limit_applied boolean not null default false;
