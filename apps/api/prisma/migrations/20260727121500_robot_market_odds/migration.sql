-- Per-market "odd indicada" for "Histórico do Robô" (apps/web/src/app/admin/AdminPage.tsx)
-- — admin-editable, drives the extra "Lucro com odd indicada" stat on the
-- market detail page (robot-signals/routes.ts). Only ever read/written by
-- our own backend via Prisma, never by a direct Supabase client, so RLS is
-- enabled with no policies (deny anon/authenticated outright; the backend's
-- DB role bypasses RLS same as every other admin-only table here).
create table public.robot_market_odds (
    group_key      text not null,
    indicated_odd  numeric(6, 3) not null,
    updated_at     timestamptz not null default now(),

    constraint robot_market_odds_pkey primary key (group_key)
);

alter table public.robot_market_odds enable row level security;

-- Over 0.5 Corners FT (groupKey from marketNormalizer.ts) — real recorded
-- odds here average ~1.83, but 2.025 is the odd actually recommended for
-- this entry, so that's the default "odd indicada" (product decision,
-- 2026-07-27).
insert into public.robot_market_odds (group_key, indicated_odd)
values ('over|Corners|0.5|FT', 2.025)
on conflict do nothing;
