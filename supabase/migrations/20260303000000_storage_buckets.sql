-- Create storage buckets for avatars and team images
insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', false),
  ('team-images', 'team-images', false)
on conflict (id) do nothing;

-- ── Avatars bucket ────────────────────────────────────────────────────────────

create policy "Users can upload own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = split_part(name, '/', 1)
  );

create policy "Users can update own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = split_part(name, '/', 1)
  );

create policy "Users can delete own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = split_part(name, '/', 1)
  );

create policy "Authenticated users can view avatars"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars');

-- ── Team images bucket ────────────────────────────────────────────────────────

create policy "Admins can upload team images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'team-images'
    and is_team_admin(split_part(name, '/', 1)::uuid)
  );

create policy "Admins can update team images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'team-images'
    and is_team_admin(split_part(name, '/', 1)::uuid)
  );

create policy "Admins can delete team images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'team-images'
    and is_team_admin(split_part(name, '/', 1)::uuid)
  );

create policy "Team members can view team images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'team-images'
    and is_team_member(split_part(name, '/', 1)::uuid)
  );
