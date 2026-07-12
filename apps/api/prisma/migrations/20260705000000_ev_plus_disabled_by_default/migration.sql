-- EV+ has no real data source yet (Neo IA was dropped; a scraping-based
-- replacement is planned but not built). Hide it from regular users until an
-- admin re-enables it via "Admin · Telas & Permissões" (role_screen_access
-- for the `user` role, same table that screen edits).
delete from public.role_screen_access
using public.roles r
where role_screen_access.role_id = r.id
  and r.name in ('user', 'tipster', 'tipster_verified')
  and role_screen_access.screen_key = 'ev_plus';
