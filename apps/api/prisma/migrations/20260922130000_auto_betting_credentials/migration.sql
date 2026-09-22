-- "Aposta automática": bookmaker logins (AES-256-GCM encrypted by the API,
-- key in a Fly secret — never here) and the betting extension's key (only
-- its SHA-256). Backend-only tables: RLS on, no policies, same as the rest.
create table public.bookmaker_credentials (
    user_id        uuid not null,
    bookmaker      text not null,
    username_enc   text not null,
    password_enc   text not null,
    username_hint  text not null,
    updated_at     timestamptz not null default now(),

    constraint bookmaker_credentials_pkey primary key (user_id, bookmaker),
    constraint bookmaker_credentials_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade
);

alter table public.bookmaker_credentials enable row level security;

create table public.extension_keys (
    user_id       uuid not null,
    key_hash      text not null,
    created_at    timestamptz not null default now(),
    last_used_at  timestamptz,

    constraint extension_keys_pkey primary key (user_id),
    constraint extension_keys_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade
);

create unique index extension_keys_key_hash_key on public.extension_keys (key_hash);

alter table public.extension_keys enable row level security;
