-- Allow managers to upload/update/delete avatars for profiles they manage.
--
-- The avatar bucket path format is: {profile_id}/{filename}
-- The existing policies only permit auth.uid() == profile_id.
-- A parent uploading their child's avatar has auth.uid() == parent_id,
-- so the path's first segment (child's profile_id) fails the equality check.
-- Extending to also allow is_managed_by_me(profile_id) fixes this.

drop policy if exists "Users can upload own avatar" on storage.objects;
drop policy if exists "Users can update own avatar" on storage.objects;
drop policy if exists "Users can delete own avatar" on storage.objects;

create policy "Users can upload own or managed avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (
      auth.uid()::text = split_part(name, '/', 1)
      or is_managed_by_me(split_part(name, '/', 1)::uuid)
    )
  );

create policy "Users can update own or managed avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (
      auth.uid()::text = split_part(name, '/', 1)
      or is_managed_by_me(split_part(name, '/', 1)::uuid)
    )
  );

create policy "Users can delete own or managed avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (
      auth.uid()::text = split_part(name, '/', 1)
      or is_managed_by_me(split_part(name, '/', 1)::uuid)
    )
  );
