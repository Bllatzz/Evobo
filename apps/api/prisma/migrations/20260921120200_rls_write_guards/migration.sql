-- Review fix: the Data API write policies only checked "row belongs to me".
-- That let a client (a) keep writing after an admin deactivated the account —
-- authGuard checks users.is_active on the Fastify side, RLS did not —
-- (b) comment on / "take" a tip it cannot see (VIP), (c) move a comment to a
-- different tip, (d) attach a tip to someone else's VIP group and (e)
-- follow itself. The Fastify backend is unaffected: Prisma bypasses RLS and
-- the API routes already enforce these rules.

-- The caller's account is still active. users_select_public lets anon and
-- authenticated read public.users, so a plain invoker-rights function works.
create or replace function public.current_user_is_active()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.is_active
  );
$$;

-- ── tips ────────────────────────────────────────────────────────────────
-- Builds on 20260921120000_tips_client_write_guards (pending-only inserts).
drop policy if exists tips_insert_own on public.tips;
create policy tips_insert_own on public.tips
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.current_user_is_active()
    and status = 'pending'
    and result_settled_at is null
    and (
      vip_group_id is null
      or exists (
        select 1 from public.vip_groups g
        where g.id = vip_group_id and g.owner_id = auth.uid()
      )
    )
  );

drop policy if exists tips_update_own on public.tips;
create policy tips_update_own on public.tips
  for update to authenticated
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and public.current_user_is_active()
    and (
      vip_group_id is null
      or exists (
        select 1 from public.vip_groups g
        where g.id = vip_group_id and g.owner_id = auth.uid()
      )
    )
  );

-- ── comments ────────────────────────────────────────────────────────────
-- The EXISTS on tips runs as the caller, so it only matches tips the caller
-- is allowed to see (tips_select_visible).
drop policy if exists comments_insert_own on public.comments;
create policy comments_insert_own on public.comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.current_user_is_active()
    and exists (select 1 from public.tips t where t.id = comments.tip_id)
  );

drop policy if exists comments_update_own on public.comments;
create policy comments_update_own on public.comments
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.current_user_is_active());

-- A comment can be edited/soft-deleted, but never moved to another tip or
-- handed to another author.
create or replace function public.prevent_comment_reparent()
returns trigger
language plpgsql
as $$
begin
  if new.tip_id is distinct from old.tip_id or new.author_id is distinct from old.author_id then
    raise exception 'comment tip and author cannot be changed';
  end if;
  return new;
end;
$$;

create trigger prevent_comment_reparent
  before update on public.comments
  for each row execute function public.prevent_comment_reparent();

-- ── tip_takes ("Peguei") ────────────────────────────────────────────────
drop policy if exists tip_takes_insert_own on public.tip_takes;
create policy tip_takes_insert_own on public.tip_takes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.current_user_is_active()
    and exists (select 1 from public.tips t where t.id = tip_takes.tip_id)
  );

-- ── follows ─────────────────────────────────────────────────────────────
drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows
  for insert to authenticated
  with check (
    follower_id = auth.uid()
    and followed_id <> follower_id
    and public.current_user_is_active()
  );
