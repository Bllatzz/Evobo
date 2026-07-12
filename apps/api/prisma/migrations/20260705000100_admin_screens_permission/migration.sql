-- "Admin · Telas & Permissões" (apps/web/src/app/admin/screens/AdminScreensPage.tsx) —
-- admin-only screen that edits the `user` role's own screen access.
insert into public.role_screen_access (role_id, screen_key)
select r.id, 'admin_screens'
from public.roles r
where r.name = 'admin'
on conflict do nothing;
