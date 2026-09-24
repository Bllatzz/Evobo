-- "Aposta automática" configurada no Evobo (não mais no popup da extensão):
-- liga/desliga, modo (só conferir / apostar de verdade) e teto por aposta.
-- O valor da unidade continua em telegram_banca_settings.unit_value.
-- E o histórico do que a extensão fez com cada tip, que antes só existia no
-- chrome.storage do navegador. Backend-only: RLS ligado, sem policies, igual
-- às outras tabelas da aposta automática.
create table public.auto_bet_settings (
    user_id          uuid not null,
    enabled          boolean not null default false,
    place_real       boolean not null default false,
    max_stake_reais  numeric(10, 2) not null default 50,
    -- Quando foi ligado pela última vez: só tips recebidas depois disso entram.
    enabled_since    timestamptz,
    updated_at       timestamptz not null default now(),

    constraint auto_bet_settings_pkey primary key (user_id),
    constraint auto_bet_settings_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade,
    constraint auto_bet_settings_max_stake_positive check (max_stake_reais > 0)
);

alter table public.auto_bet_settings enable row level security;

create table public.auto_bet_runs (
    id          uuid not null default gen_random_uuid(),
    user_id     uuid not null,
    bookmaker   text not null,
    -- `${groupId}:${telegramMessageId}` da fila, ou "manual:<ms>" do "Testar um link".
    task_key    text not null,
    bet_url     text,
    title       text,
    -- apostou | conferiu | pulou | abortou | verificar | erro
    status      text not null,
    summary     text not null,
    dry_run     boolean not null,
    report      jsonb,
    created_at  timestamptz not null default now(),

    constraint auto_bet_runs_pkey primary key (id),
    constraint auto_bet_runs_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade
);

-- Histórico do perfil (mais recentes primeiro) e "essa tip já foi processada?".
create index auto_bet_runs_user_created_idx on public.auto_bet_runs (user_id, created_at desc);
create index auto_bet_runs_user_task_idx on public.auto_bet_runs (user_id, task_key);

alter table public.auto_bet_runs enable row level security;
