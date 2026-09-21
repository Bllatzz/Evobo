-- Review fix: clients writing straight through the Supabase Data API could
-- forge a settled tip (insert with status = 'green' and huge odds) or rewrite
-- odds/stake after a tip was settled, both of which feed the ranking's
-- ROI/hit-rate math. The original guard only covered UPDATE of `status`.
--
-- The Fastify backend is unaffected: it connects through Prisma (bypasses RLS),
-- creates tips as `pending` by default, and settles them (when that exists)
-- through withPrivilegedWrite("tipStatus"), which sets the bypass GUC below.

-- Data API inserts can only create a pending, unsettled tip.
drop policy if exists tips_insert_own on public.tips;
create policy tips_insert_own on public.tips
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and status = 'pending'
    and result_settled_at is null
  );

-- Extend the existing guard: besides status, clients can't touch the
-- settlement time, and a settled tip's numbers are frozen. The trigger
-- (prevent_tip_status_client_update, BEFORE UPDATE) already exists — only the
-- function body changes.
create or replace function public.prevent_tip_status_client_update()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.bypass_tip_status_guard', true), 'false') <> 'true' then
    if new.status is distinct from old.status then
      raise exception 'tip status can only be settled by the backend';
    end if;
    if new.result_settled_at is distinct from old.result_settled_at then
      raise exception 'tip settlement time can only be set by the backend';
    end if;
    if old.status <> 'pending' and (
         new.odds is distinct from old.odds
      or new.stake_units is distinct from old.stake_units
      or new.market is distinct from old.market
      or new.match_id is distinct from old.match_id
      or new.house is distinct from old.house
    ) then
      raise exception 'settled tips are immutable';
    end if;
  end if;
  return new;
end;
$$;
