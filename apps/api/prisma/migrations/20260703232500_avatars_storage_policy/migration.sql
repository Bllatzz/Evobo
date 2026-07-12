-- Avatar uploads (Meu Perfil "colocar foto"). Bucket itself is created via
-- the Storage API / supabase/config.toml (public = true) — this migration
-- only adds the storage.objects RLS policies restricting who can write.
-- Path convention: avatars/{auth.uid()}/{filename} — a user may only
-- write under their own folder; reads are public (matches bucket setting).

create policy "avatars_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

create policy "avatars_own_folder_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_own_folder_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_own_folder_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
