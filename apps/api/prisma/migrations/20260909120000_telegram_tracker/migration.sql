-- Banca Telegram: personal tip tracker fed by a Telegram MTProto listener
-- (apps/worker), separate from robot-signals' proxy to robotip and from the
-- public Tip/VipGroup feed. Only ever read/written by our own backend
-- (telegram-tips module) or the worker via Prisma — never by a direct
-- Supabase client — so RLS is enabled with no policies, same convention as
-- vip_subscriptions/robot_market_odds: deny anon/authenticated outright, the
-- backend's DB role bypasses RLS regardless.

create table public.telegram_groups (
    id                uuid not null default gen_random_uuid(),
    name              text not null,
    telegram_chat_id  text not null,
    active            boolean not null default true,
    created_at        timestamptz not null default now(),

    constraint telegram_groups_pkey primary key (id)
);

create unique index telegram_groups_telegram_chat_id_key on public.telegram_groups (telegram_chat_id);

alter table public.telegram_groups enable row level security;

-- One row per selection (a multi-selection message, e.g. 3 separate stake
-- lines, becomes N rows sharing the same telegram_message_id/photo_path; a
-- combo/"múltipla" bet across several markets stays 1 row with `selection`
-- listing all legs). Tips land here directly as soon as the worker parses
-- the message — no separate approval queue.
create table public.telegram_tips (
    id                   uuid not null default gen_random_uuid(),
    group_id             uuid not null,
    telegram_message_id  bigint not null,
    match                text,
    selection            text not null,
    unit                 numeric(5, 2),
    odd                  numeric(6, 2),
    odd_source           text,
    bookmaker            text,
    bet_url              text,
    photo_path           text,
    result               text not null default 'pending',
    taken_status         text not null default 'pending',
    parse_pattern        text,
    received_at          timestamptz not null default now(),
    raw_message          text,

    constraint telegram_tips_pkey primary key (id),
    constraint telegram_tips_group_id_fkey foreign key (group_id) references public.telegram_groups (id)
);

create index telegram_tips_telegram_message_id_idx on public.telegram_tips (telegram_message_id);
create index telegram_tips_group_id_idx on public.telegram_tips (group_id);

alter table public.telegram_tips enable row level security;

-- Per-user bankroll settings — value of 1 unit in R$, used to convert the
-- unit-based profit/ROI on the Banca Telegram report into currency.
create table public.telegram_banca_settings (
    user_id     uuid not null,
    unit_value  numeric(10, 2),
    updated_at  timestamptz not null default now(),

    constraint telegram_banca_settings_pkey primary key (user_id),
    constraint telegram_banca_settings_user_id_fkey foreign key (user_id) references public.users (id)
);

alter table public.telegram_banca_settings enable row level security;

-- How much money the user has parked in each bookmaker — informational,
-- entered manually on the profile page for bankroll management.
create table public.telegram_bookmaker_balances (
    id          uuid not null default gen_random_uuid(),
    user_id     uuid not null,
    bookmaker   text not null,
    balance     numeric(10, 2) not null,
    updated_at  timestamptz not null default now(),

    constraint telegram_bookmaker_balances_pkey primary key (id),
    constraint telegram_bookmaker_balances_user_id_fkey foreign key (user_id) references public.users (id)
);

create unique index telegram_bookmaker_balances_user_id_bookmaker_key
    on public.telegram_bookmaker_balances (user_id, bookmaker);

alter table public.telegram_bookmaker_balances enable row level security;
