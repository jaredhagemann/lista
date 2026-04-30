-- ── Director role + updated RLS helpers + team archiving ─────────────────────
-- 1. Add 'director' to team_members.role CHECK constraint
-- 2. Replace is_team_member() and is_team_admin() with org-aware versions
--    that grant directors implicit cross-team access and exclude archived teams
-- 3. Add archived_at to teams

-- ── 1. Add 'director' to team_members role ───────────────────────────────────

ALTER TABLE team_members DROP CONSTRAINT team_members_role_check;
ALTER TABLE team_members ADD CONSTRAINT team_members_role_check
  CHECK (role IN ('coach', 'manager', 'parent', 'player', 'director'));

-- ── 2. Add archived_at to teams ───────────────────────────────────────────────

ALTER TABLE teams ADD COLUMN archived_at timestamptz;

CREATE INDEX teams_organization_id_idx ON teams (organization_id);

-- ── 3. Replace is_team_member() ───────────────────────────────────────────────
-- Changes from original:
--   a) Joins through profiles via auth_user_id (not profile_id = auth.uid())
--      to support the managed-profile model added in 20260303000002.
--   b) Includes guardian/manager access via profile_managers.
--   c) Adds OR is_org_admin(team_org_id(t_id)) so directors get implicit access
--      to all teams in their org without needing an explicit team_members row.
--   d) Excludes archived teams for non-org-admins (the org admin branch still
--      returns true for archived teams, allowing directors to view them).

CREATE OR REPLACE FUNCTION is_team_member(t_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members tm
    JOIN profiles p ON p.id = tm.profile_id
    -- Exclude archived teams for regular members
    JOIN teams t ON t.id = tm.team_id
      AND (t.archived_at IS NULL OR is_org_admin(t.organization_id))
    WHERE tm.team_id = t_id
      AND (
        p.auth_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM profile_managers pm
          JOIN profiles mgr ON mgr.id = pm.manager_id
          WHERE pm.managed_id = p.id AND mgr.auth_user_id = auth.uid()
        )
      )
  )
  -- Directors have implicit membership access to all teams in their org,
  -- including teams they didn't directly create (no team_members row needed).
  -- is_org_admin() already returns true for archived teams when the caller
  -- is an org admin, so no extra archived_at guard is needed here.
  OR is_org_admin(team_org_id(t_id));
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── 4. Replace is_team_admin() ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_team_admin(t_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members tm
    JOIN profiles p ON p.id = tm.profile_id
    -- Exclude archived teams for non-org-admins
    JOIN teams t ON t.id = tm.team_id
      AND (t.archived_at IS NULL OR is_org_admin(t.organization_id))
    WHERE tm.team_id = t_id
      AND p.auth_user_id = auth.uid()
      AND tm.role IN ('coach', 'manager', 'director')
  )
  -- Directors have implicit admin access to all teams in their org.
  OR is_org_admin(team_org_id(t_id));
$$ LANGUAGE sql SECURITY DEFINER STABLE;
