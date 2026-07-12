-- "Peguei" — a viewer marking they took a tip. Not in the originally
-- approved schema; added because the Feed/Tip aberta "Peguei" button and
-- Meu Perfil's "Minhas apostas" tab both require it.
create table public.tip_takes (
    id uuid not null default gen_random_uuid(),
    tip_id uuid not null,
    user_id uuid not null,
    created_at timestamptz not null default now(),

    constraint tip_takes_pkey primary key (id),
    constraint tip_takes_tip_id_fkey foreign key (tip_id) references public.tips (id) on delete cascade,
    constraint tip_takes_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade,
    constraint tip_takes_tip_id_user_id_key unique (tip_id, user_id)
);

create index tip_takes_user_id_idx on public.tip_takes (user_id);

alter table public.tip_takes enable row level security;

-- Take counts are public (like a like count); only the taker can create/remove their own row.
create policy tip_takes_select_public on public.tip_takes
  for select to anon, authenticated
  using (true);

create policy tip_takes_insert_own on public.tip_takes
  for insert to authenticated
  with check (user_id = auth.uid());

create policy tip_takes_delete_own on public.tip_takes
  for delete to authenticated
  using (user_id = auth.uid());
