-- Saques lançados no perfil ("Unidade & saldos"): tiram do saldo da casa e
-- da banca atual, nunca do lucro. Backend-only: RLS ligado, sem policies,
-- igual a telegram_bookmaker_balances.
create table public.telegram_bookmaker_withdrawals (
    id            uuid not null default gen_random_uuid(),
    user_id       uuid not null,
    bookmaker     text not null,
    amount        numeric(10, 2) not null,
    withdrawn_at  date not null,
    created_at    timestamptz not null default now(),

    constraint telegram_bookmaker_withdrawals_pkey primary key (id),
    constraint telegram_bookmaker_withdrawals_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade,
    constraint telegram_bookmaker_withdrawals_amount_positive check (amount > 0)
);

create index telegram_bookmaker_withdrawals_user_id_withdrawn_at_idx on public.telegram_bookmaker_withdrawals (user_id, withdrawn_at);

alter table public.telegram_bookmaker_withdrawals enable row level security;
