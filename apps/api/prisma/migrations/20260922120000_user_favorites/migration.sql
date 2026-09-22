-- Teams/leagues starred on the Jogos page, keyed by robotip's own ids (the
-- jogosdodia feed's home_id/away_id and id_liga). Name/image are snapshotted
-- so the list renders without the day's feed. Same RLS convention as the
-- other backend-only tables: enabled, no policies — the API reads/writes it
-- through Prisma, never a direct Supabase client.
create type public.favorite_kind as enum ('team', 'league');

create table public.user_favorites (
    user_id      uuid not null,
    kind         public.favorite_kind not null,
    external_id  text not null,
    name         text not null,
    image_url    text,
    created_at   timestamptz not null default now(),

    constraint user_favorites_pkey primary key (user_id, kind, external_id),
    constraint user_favorites_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade
);

alter table public.user_favorites enable row level security;
