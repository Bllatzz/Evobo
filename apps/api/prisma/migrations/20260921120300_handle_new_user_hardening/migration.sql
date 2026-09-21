-- Review fix for handle_new_user() (profile auto-creation on signup), three
-- small edge cases in the original (20260703015700_rls_trigger_seed):
--
--  1. Username "me" collided with GET /users/me, hiding that user's public
--     profile — it is now reserved (falls back to "user", like any empty name).
--  2. Two signups with the same display name at the same time both saw the
--     username as free; the loser hit a unique violation and its whole signup
--     failed. The insert now retries with the next suffix.
--  3. A signup with no display_name and no e-mail (or a blank display_name)
--     hit the NOT NULL on display_name. It now falls back to "user".
--
-- Same signature/attributes as before, so the on_auth_user_created trigger
-- keeps pointing at it. Only affects NEW signups — existing usernames are
-- untouched.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_role_id uuid;
  shown_name text;
  base_username text;
  final_username text;
  suffix int := 0;
  attempts int := 0;
begin
  select id into default_role_id from public.roles where name = 'user';
  if default_role_id is null then
    raise exception 'handle_new_user: role "user" is missing from public.roles';
  end if;

  -- Registro screen only collects nome/e-mail/senha (no username field), so
  -- the username is generated here and can be changed later in profile
  -- settings.
  shown_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'user'
  );

  base_username := lower(regexp_replace(shown_name, '[^a-z0-9]+', '', 'gi'));
  if base_username is null or base_username = '' or base_username = 'me' then
    base_username := 'user';
  end if;

  final_username := base_username;
  loop
    while exists (select 1 from public.users where username = final_username) loop
      suffix := suffix + 1;
      final_username := base_username || suffix::text;
    end loop;

    begin
      insert into public.users (id, username, display_name, role_id)
      values (new.id, final_username, shown_name, default_role_id);
      exit;
    exception when unique_violation then
      -- A concurrent signup took this username between the check and the
      -- insert: try the next suffix. Bounded so a violation that isn't about
      -- the username (e.g. the id already exists) can't loop forever.
      attempts := attempts + 1;
      if attempts >= 10 then
        raise;
      end if;
      suffix := suffix + 1;
      final_username := base_username || suffix::text;
    end;
  end loop;

  return new;
end;
$$;
