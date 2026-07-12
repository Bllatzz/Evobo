-- ═══════════════════════════════════════════════════════════════════
-- 1. FK from the public profile to Supabase Auth's user record
-- ═══════════════════════════════════════════════════════════════════
alter table public.users
  add constraint users_id_fkey foreign key (id) references auth.users (id) on delete cascade;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Profile auto-creation on signup (Supabase's documented pattern:
--    https://supabase.com/docs/guides/auth/managing-user-data)
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_role_id uuid;
  base_username text;
  final_username text;
  suffix int := 0;
begin
  select id into default_role_id from public.roles where name = 'user';

  -- Registro screen only collects nome/e-mail/senha (no username field), so
  -- the username is generated here and can be changed later in profile
  -- settings.
  base_username := lower(regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    '[^a-z0-9]+', '', 'gi'
  ));
  if base_username is null or base_username = '' then
    base_username := 'user';
  end if;

  final_username := base_username;
  while exists (select 1 from public.users where username = final_username) loop
    suffix := suffix + 1;
    final_username := base_username || suffix::text;
  end loop;

  insert into public.users (id, username, display_name, role_id)
  values (
    new.id,
    final_username,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    default_role_id
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════════
-- 3. Defense in depth: block privileged self-updates even if a bug ever
--    let a permissive RLS policy through. service_role (the backend) is
--    exempt since that's the only place these fields should change.
-- ═══════════════════════════════════════════════════════════════════
-- These guards can't key off current_user: our Fastify backend connects to
-- Postgres directly through Prisma under its own role (not literally
-- `service_role` — that role is specific to PostgREST/Supabase's REST API
-- layer, which Prisma never goes through), and RLS-permitted client writes
-- from anon/authenticated must stay blocked regardless of which role name a
-- given deployment happens to use for the app connection. Instead, the
-- backend explicitly opts in per-transaction via a GUC — see
-- withPrivilegedWrite() in src/db/prisma.ts. Unset (the default for every
-- other write path, backend or client) means blocked.
create or replace function public.prevent_users_privileged_self_update()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.bypass_user_guard', true), 'false') <> 'true' then
    if new.role_id is distinct from old.role_id then
      raise exception 'role_id can only be changed by an administrator';
    end if;
    if new.verified_at is distinct from old.verified_at
      or new.verified_badge_reason is distinct from old.verified_badge_reason then
      raise exception 'verification status can only be changed by an administrator';
    end if;
    if new.is_active is distinct from old.is_active then
      raise exception 'account status can only be changed by an administrator';
    end if;
  end if;
  return new;
end;
$$;

create trigger prevent_users_privileged_self_update
  before update on public.users
  for each row execute function public.prevent_users_privileged_self_update();

create or replace function public.prevent_tip_status_client_update()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.bypass_tip_status_guard', true), 'false') <> 'true'
    and new.status is distinct from old.status then
    raise exception 'tip status can only be settled by the backend';
  end if;
  return new;
end;
$$;

create trigger prevent_tip_status_client_update
  before update on public.tips
  for each row execute function public.prevent_tip_status_client_update();

-- ═══════════════════════════════════════════════════════════════════
-- 3b. updated_at is Prisma Client-side magic (@updatedAt) — it does nothing
--     for writes that don't go through Prisma, e.g. a client updating its
--     own tip/profile directly via Supabase RLS. Give every updated_at
--     column a real DB default and an auto-touch trigger so it's correct
--     regardless of which path wrote the row.
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.roles alter column updated_at set default now();
alter table public.users alter column updated_at set default now();
alter table public.games alter column updated_at set default now();
alter table public.tips alter column updated_at set default now();
alter table public.payments alter column updated_at set default now();

create trigger set_updated_at before update on public.roles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.users
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.games
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.tips
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- 4. Seed the 4 system roles + default screen access
-- ═══════════════════════════════════════════════════════════════════
insert into public.roles (name, description, is_system) values
  ('user', 'Usuário padrão da plataforma', true),
  ('tipster', 'Usuário que publica tips e pode monetizar via grupo VIP', true),
  ('tipster_verified', 'Tipster com selo de verificação por histórico de acertos', true),
  ('admin', 'Administrador da plataforma', true)
on conflict (name) do nothing;

insert into public.role_screen_access (role_id, screen_key)
select r.id, s.screen_key
from public.roles r
cross join (values
  ('feed'), ('ao_vivo'), ('ev_plus'), ('ranking'), ('jogos'), ('busca'),
  ('tip_aberta'), ('analise_ia'), ('grupo_vip'), ('checkout'),
  ('meu_perfil'), ('perfil'), ('nova_tip'), ('robo_apostas')
) as s(screen_key)
where r.name in ('user', 'tipster', 'tipster_verified')
on conflict do nothing;

insert into public.role_screen_access (role_id, screen_key)
select r.id, s.screen_key
from public.roles r
cross join (values
  ('feed'), ('ao_vivo'), ('ev_plus'), ('ranking'), ('jogos'), ('busca'),
  ('tip_aberta'), ('analise_ia'), ('grupo_vip'), ('checkout'),
  ('meu_perfil'), ('perfil'), ('nova_tip'), ('robo_apostas'),
  ('admin'), ('admin_roles'), ('admin_payments')
) as s(screen_key)
where r.name = 'admin'
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- 5. Row Level Security — every table, explicit per-operation policies.
--    No `using (true)` anywhere except genuinely public read data.
-- ═══════════════════════════════════════════════════════════════════

-- users: public profile read; owner-only write (privileged fields blocked
-- by the trigger above regardless of what a policy would allow).
alter table public.users enable row level security;

create policy users_select_public on public.users
  for select to anon, authenticated
  using (true);

create policy users_update_own on public.users
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- roles / role_screen_access: public read (frontend route guard needs it),
-- writes are service_role-only (no policy for insert/update/delete = denied).
alter table public.roles enable row level security;

create policy roles_select_public on public.roles
  for select to anon, authenticated
  using (true);

alter table public.role_screen_access enable row level security;

create policy role_screen_access_select_public on public.role_screen_access
  for select to anon, authenticated
  using (true);

-- games: public read, synced by the backend only.
alter table public.games enable row level security;

create policy games_select_public on public.games
  for select to anon, authenticated
  using (true);

-- tips: public tips visible to everyone; vip_only visible to the author and
-- to active subscribers of that vip_group.
alter table public.tips enable row level security;

create policy tips_select_visible on public.tips
  for select to anon, authenticated
  using (
    visibility = 'public'
    or author_id = auth.uid()
    or exists (
      select 1 from public.vip_subscriptions vs
      where vs.vip_group_id = tips.vip_group_id
        and vs.user_id = auth.uid()
        and vs.status = 'active'
        and vs.expires_at > now()
    )
  );

create policy tips_insert_own on public.tips
  for insert to authenticated
  with check (author_id = auth.uid());

create policy tips_update_own on public.tips
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- vip_groups: public read; only tipster/tipster_verified/admin can own one.
alter table public.vip_groups enable row level security;

create policy vip_groups_select_public on public.vip_groups
  for select to anon, authenticated
  using (true);

create policy vip_groups_insert_own on public.vip_groups
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.users u
      join public.roles r on r.id = u.role_id
      where u.id = auth.uid() and r.name in ('tipster', 'tipster_verified', 'admin')
    )
  );

create policy vip_groups_update_own on public.vip_groups
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- vip_subscriptions: zero client access, activated by the backend only
-- after a payment is approved. RLS enabled, deliberately no policies.
alter table public.vip_subscriptions enable row level security;

-- payments: user reads own payments (to poll status), admin reads all (for
-- the Aprovação de Pagamentos queue). All writes are backend/service_role —
-- see project memory "payments-manual-pix".
alter table public.payments enable row level security;

create policy payments_select_own_or_admin on public.payments
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.users u
      join public.roles r on r.id = u.role_id
      where u.id = auth.uid() and r.name = 'admin'
    )
  );

-- follows: public graph; only the follower can create/remove their own edge.
alter table public.follows enable row level security;

create policy follows_select_public on public.follows
  for select to anon, authenticated
  using (true);

create policy follows_insert_own on public.follows
  for insert to authenticated
  with check (follower_id = auth.uid());

create policy follows_delete_own on public.follows
  for delete to authenticated
  using (follower_id = auth.uid());

-- comments: visible to whoever can see the parent tip; author writes own.
alter table public.comments enable row level security;

create policy comments_select_visible on public.comments
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.tips t
      where t.id = comments.tip_id
        and (
          t.visibility = 'public'
          or t.author_id = auth.uid()
          or exists (
            select 1 from public.vip_subscriptions vs
            where vs.vip_group_id = t.vip_group_id
              and vs.user_id = auth.uid()
              and vs.status = 'active'
              and vs.expires_at > now()
          )
        )
    )
  );

create policy comments_insert_own on public.comments
  for insert to authenticated
  with check (author_id = auth.uid());

create policy comments_update_own on public.comments
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- notifications: owner-only, backend creates them.
alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- audit_logs: admin read-only, backend writes.
alter table public.audit_logs enable row level security;

create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      join public.roles r on r.id = u.role_id
      where u.id = auth.uid() and r.name = 'admin'
    )
  );
