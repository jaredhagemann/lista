-- Create storage bucket for org/club images (logos, favicons).
-- Public bucket: files must be browser-loadable without auth (favicon use case).
insert into storage.buckets (id, name, public)
values ('org-images', 'org-images', true)
on conflict (id) do nothing;

-- Only org owners may upload files into their org's folder (<orgId>/...).
-- Uses is_org_owner() (SECURITY DEFINER) — same pattern as is_team_admin() on
-- team-images — to avoid RLS recursion when the policy subquery hits
-- organization_members, which itself has RLS enabled.
create policy "Org owners can upload org images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-images'
    and is_org_owner(split_part(name, '/', 1)::uuid)
  );

create policy "Org owners can update org images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'org-images'
    and is_org_owner(split_part(name, '/', 1)::uuid)
  );

create policy "Org owners can delete org images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'org-images'
    and is_org_owner(split_part(name, '/', 1)::uuid)
  );
