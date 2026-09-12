-- "VIP Telegram · Tips oficiais" (apps/web/src/app/admin/telegram-tips/AdminTelegramTipsPage.tsx) —
-- admin-only screen for correcting the official odd/unit/casa/result of a
-- TelegramTip, separate from the per-user personal tracking on /telegram-tips.
insert into public.role_screen_access (role_id, screen_key)
select r.id, 'admin_telegram_tips'
from public.roles r
where r.name = 'admin'
on conflict do nothing;
