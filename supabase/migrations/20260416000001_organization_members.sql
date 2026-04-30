-- ── organization_members table ────────────────────────────────────────────────
-- Establishes org-level roles. Two roles:
--   owner    — full control: billing, branding, subdomain, team creation,
--              inviting directors. Exactly one per org (enforced by partial
--              unique index below).
--   director — can create teams, manage all teams in the org, invite members.
--              No billing access.
--
-- Both are collectively referred to as "directors" in the product UI; the
-- distinction only matters for billing access.

CREATE TABLE organization_members (
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id      uuid REFERENCES profiles(id)      ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('owner', 'director')),
  created_at      timestamptz DEFAULT now(),
  PRIMARY KEY (organization_id, profile_id)
);

-- Enforce exactly one owner per org at the database level.
-- Ownership transfer must DELETE the old row before inserting the new one
-- (or UPDATE the existing row's profile_id).
CREATE UNIQUE INDEX organization_members_one_owner
  ON organization_members (organization_id)
  WHERE role = 'owner';

-- Performance indexes for the RLS helper queries.
CREATE INDEX organization_members_profile_org_idx
  ON organization_members (profile_id, organization_id);

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- ── RLS helper functions ──────────────────────────────────────────────────────

-- get_user_org_ids(): returns the org IDs the current user belongs to.
-- SECURITY DEFINER so it bypasses RLS when called from inside an RLS policy
-- on organization_members — prevents infinite recursion.
CREATE OR REPLACE FUNCTION get_user_org_ids() RETURNS SETOF uuid AS $$
  SELECT organization_id FROM organization_members om
  JOIN profiles p ON p.id = om.profile_id
  WHERE p.auth_user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- is_org_admin(): true if the current user is an owner or director in the org.
CREATE OR REPLACE FUNCTION is_org_admin(o_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members om
    JOIN profiles p ON p.id = om.profile_id
    WHERE om.organization_id = o_id
      AND p.auth_user_id = auth.uid()
      AND om.role IN ('owner', 'director')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- is_org_owner(): true if the current user is the owner of the org.
CREATE OR REPLACE FUNCTION is_org_owner(o_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members om
    JOIN profiles p ON p.id = om.profile_id
    WHERE om.organization_id = o_id
      AND p.auth_user_id = auth.uid()
      AND om.role = 'owner'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- team_org_id(): returns the organization_id for a given team.
-- Used inside is_team_member/is_team_admin to resolve the org without
-- re-entering those functions.
CREATE OR REPLACE FUNCTION team_org_id(t_id uuid) RETURNS uuid AS $$
  SELECT organization_id FROM teams WHERE id = t_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── RLS policies ──────────────────────────────────────────────────────────────

-- SELECT: any org member (owner or director) can see the full member list.
-- Uses get_user_org_ids() rather than an inline sub-query on this table to
-- avoid infinite recursion (the sub-query would re-enter this policy).
CREATE POLICY "org members can view org_members"
  ON organization_members FOR SELECT
  USING (
    profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
    OR organization_id IN (SELECT get_user_org_ids())
  );

-- ALL (INSERT/UPDATE/DELETE): only the org owner can manage org membership
-- (add/remove directors, transfer ownership).
CREATE POLICY "org owners can manage org_members"
  ON organization_members FOR ALL
  USING (is_org_owner(organization_id))
  WITH CHECK (is_org_owner(organization_id));

-- ── RLS policies for organizations ───────────────────────────────────────────
-- Defined here (not in 20260416000000) because organization_members,
-- is_org_admin(), and is_org_owner() must all exist before these policies
-- can be created.

-- SELECT: visible to profiles that are a direct team member in this org,
-- or are an explicit org member in organization_members.
CREATE POLICY "Orgs visible to members"
  ON organizations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      JOIN profiles p ON p.id = tm.profile_id
      WHERE t.organization_id = organizations.id
        AND p.auth_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM organization_members om
      JOIN profiles p ON p.id = om.profile_id
      WHERE om.organization_id = organizations.id
        AND p.auth_user_id = auth.uid()
    )
  );

-- UPDATE: only org owners/admins may update branding, settings, etc.
CREATE POLICY "Orgs updatable by org admins"
  ON organizations FOR UPDATE
  USING (is_org_admin(id));

-- INSERT: no permissive client policy — blocked by default-deny.
-- Org creation is only permitted via the create_team() service-role RPC.

-- DELETE: only the org owner may delete an org.
CREATE POLICY "Orgs deletable by org owner"
  ON organizations FOR DELETE
  USING (is_org_owner(id));
