-- Data fix, not a schema change: before bookmaker_options existed, a
-- multi-bookmaker padovan_single tip fanned out into one duplicate row per
-- house (same bet). Collapses each duplicate group into a single row with
-- bookmaker_options populated, deleting the extras — same logic as
-- apps/worker/scripts/consolidate-bookmaker-dupes.ts, in SQL so it can run
-- via `prisma migrate deploy` against environments this Prisma client can't
-- reach directly (e.g. production, IPv6-only from some dev sandboxes).
-- No-ops wherever this has already been run (worker script or a prior
-- deploy of this migration) since no group of >1 will remain.
with groups as (
  select group_id, telegram_message_id
  from public.telegram_tips
  where parse_pattern = 'padovan_single'
  group by group_id, telegram_message_id
  having count(*) > 1
),
survivors as (
  select distinct on (t.group_id, t.telegram_message_id)
    t.id, t.group_id, t.telegram_message_id
  from public.telegram_tips t
  join groups g on g.group_id = t.group_id and g.telegram_message_id = t.telegram_message_id
  order by t.group_id, t.telegram_message_id,
    (t.taken_status <> 'pending' or t.result <> 'pending') desc,
    t.received_at asc
),
options as (
  select g.group_id, g.telegram_message_id,
    jsonb_agg(jsonb_build_object('bookmaker', t.bookmaker, 'betUrl', t.bet_url) order by t.received_at) as opts
  from public.telegram_tips t
  join groups g on g.group_id = t.group_id and g.telegram_message_id = t.telegram_message_id
  group by g.group_id, g.telegram_message_id
)
update public.telegram_tips t
set bookmaker = null, bet_url = null, bookmaker_options = o.opts
from survivors s
join options o on o.group_id = s.group_id and o.telegram_message_id = s.telegram_message_id
where t.id = s.id;

with groups as (
  select group_id, telegram_message_id
  from public.telegram_tips
  where parse_pattern = 'padovan_single'
    and bookmaker_options is not null
),
survivors as (
  select id from public.telegram_tips
  where bookmaker_options is not null
)
delete from public.telegram_tips t
using groups g
where t.group_id = g.group_id
  and t.telegram_message_id = g.telegram_message_id
  and t.id not in (select id from survivors);
