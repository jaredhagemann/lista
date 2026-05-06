-- Create storage bucket for org/club images (logos, favicons).
-- Public bucket: files must be browser-loadable without auth (favicon use case).
insert into storage.buckets (id, name, public)
values ('org-images', 'org-images', true)
on conflict (id) do nothing;

-- Only org owners may upload files into their org's folder (<orgId>/...).
create policy "Org owners can upload org images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-images'
    and exists (
      select 1
      from organization_members om
      join profiles p on p.id = om.profile_id
      where om.organization_id = split_part(name, '/', 1)::uuid
        and p.auth_user_id = auth.uid()
        and om.role = 'owner'
    )
  );

create policy "Org owners can update org images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'org-images'
    and exists (
      select 1
      from organization_members om
      join profiles p on p.id = om.profile_id
      where om.organization_id = split_part(name, '/', 1)::uuid
        and p.auth_user_id = auth.uid()
        and om.role = 'owner'
    )
  );

create policy "Org owners can delete org images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'org-images'
    and exists (
      select 1
      from organization_members om
      join profiles p on p.id = om.profile_id
      where om.organization_id = split_part(name, '/', 1)::uuid
        and p.auth_user_id = auth.uid()
        and om.role = 'owner'
    )
  );
