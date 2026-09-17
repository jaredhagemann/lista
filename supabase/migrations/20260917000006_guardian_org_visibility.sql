-- BUG-021: a guardian could not see their child's organization.
--
-- "Orgs visible to members" (20260416000001_organization_members.sql) admits a
-- caller only when a profile that is *itself* a team member or an org member
-- carries their auth_user_id. A guardian is neither: the membership belongs to
-- the managed child, and a managed profile has no auth_user_id at all.
--
-- The dashboard reads this row for the org's subdomain and its training gate, so
-- guardians on a club-tier team stayed on lista.team with the default branding
-- and never saw the Training nav item.
--
-- This adds a third branch for managed children, matching the access
-- is_team_member() (20260303000002_managed_profiles.sql) has granted guardians
-- everywhere else since March. The two existing branches are unchanged, so a
-- claimed profile whose id differs from its auth user id keeps its access.
--
-- Not widened: the guardian reaches exactly the orgs behind their children's
-- teams. Signup also writes a self-link into profile_managers
-- (20260306000002_self_manager_on_signup.sql); through the new branch that only
-- restates branch 1, so it grants nothing further.

drop policy if exists "Orgs visible to members" on organizations;

create policy "Orgs visible to members"
  on organizations for select
  using (
    -- The caller is on a team in this org
    exists (
      select 1
      from teams t
      join team_members tm on tm.team_id = t.id
      join profiles p on p.id = tm.profile_id
      where t.organization_id = organizations.id
        and p.auth_user_id = auth.uid()
    )
    -- The caller holds an org role
    or exists (
      select 1
      from organization_members om
      join profiles p on p.id = om.profile_id
      where om.organization_id = organizations.id
        and p.auth_user_id = auth.uid()
    )
    -- The caller manages someone on a team in this org (BUG-021)
    or exists (
      select 1
      from teams t
      join team_members tm on tm.team_id = t.id
      join profile_managers pm on pm.managed_id = tm.profile_id
      join profiles mgr on mgr.id = pm.manager_id
      where t.organization_id = organizations.id
        and mgr.auth_user_id = auth.uid()
    )
  );
