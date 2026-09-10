-- Allows purgeOldTips (apps/worker) to null out `selection` on old resolved
-- tips without violating a NOT NULL constraint — see the model comment on
-- TelegramTip in schema.prisma.
alter table public.telegram_tips alter column selection drop not null;
