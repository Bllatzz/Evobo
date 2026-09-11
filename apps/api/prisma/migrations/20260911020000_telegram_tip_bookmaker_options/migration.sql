-- A tip that can be placed at more than one house is one bet, not N — see
-- the model comment on TelegramTip.bookmakerOptions in schema.prisma.
alter table public.telegram_tips add column bookmaker_options jsonb;
