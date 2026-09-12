-- Per-user "did I take this tip, and with what stake/odd/casa" — split out
-- of telegram_tips.taken_status/unit/odd/bookmaker/bet_url so two people
-- tracking the same tip stop overwriting each other's personal record.
-- telegram_tips itself keeps unit/odd/bookmaker/result as the OFFICIAL
-- record (what the tipster said + how it graded), editable only from the
-- admin screen going forward. Same RLS convention as the rest of this
-- feature: enabled, no policies — the backend's service role bypasses RLS,
-- never touched by a direct Supabase client.
create table public.telegram_tip_takes (
    id           uuid not null default gen_random_uuid(),
    tip_id       uuid not null,
    user_id      uuid not null,
    taken_status text not null default 'pending',
    unit         numeric(5, 2),
    odd          numeric(6, 2),
    bookmaker    text,
    bet_url      text,
    updated_at   timestamptz not null default now(),

    constraint telegram_tip_takes_pkey primary key (id),
    constraint telegram_tip_takes_tip_id_fkey foreign key (tip_id) references public.telegram_tips (id) on delete cascade,
    constraint telegram_tip_takes_user_id_fkey foreign key (user_id) references public.users (id)
);

create unique index telegram_tip_takes_tip_id_user_id_key on public.telegram_tip_takes (tip_id, user_id);
create index telegram_tip_takes_user_id_idx on public.telegram_tip_takes (user_id);

alter table public.telegram_tip_takes enable row level security;

-- Backfill: today's telegram_tips.unit/odd/bookmaker/bet_url/taken_status
-- are the only historical personal activity so far, all belonging to the
-- sole admin using this feature — copy the ones that actually carry
-- signal (skip untouched/pending rows, which already mean "no take" by
-- absence in the new model) into that user's own take row.
insert into public.telegram_tip_takes (tip_id, user_id, taken_status, unit, odd, bookmaker, bet_url)
select t.id, u.id, t.taken_status, t.unit, t.odd, t.bookmaker, t.bet_url
from public.telegram_tips t
cross join (
    select id from public.users
    where role_id = (select id from public.roles where name = 'admin')
    limit 1
) u
where t.taken_status <> 'pending' or t.unit is not null or t.odd is not null or t.bookmaker is not null
on conflict (tip_id, user_id) do nothing;

alter table public.telegram_tips drop column taken_status;
