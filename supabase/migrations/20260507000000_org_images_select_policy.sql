-- Add missing SELECT policy for org-images bucket.
-- 20260506000000_org_images.sql was applied to staging before this policy was
-- added. Without it, upsert:true fails because Postgres cannot resolve
-- ON CONFLICT DO UPDATE against a row the authenticated user has no SELECT
-- access to. Kept as a separate migration so it applies incrementally to
-- staging; production receives both migrations together on first deploy.
create policy "Org owners can select org images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'org-images'
    and is_org_owner(split_part(name, '/', 1)::uuid)
  );
