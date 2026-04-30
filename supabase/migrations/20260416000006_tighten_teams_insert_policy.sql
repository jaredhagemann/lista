-- ── Tighten teams INSERT RLS ──────────────────────────────────────────────────
-- The original policy allowed any authenticated client to INSERT a team into
-- any org. Sprint 1 introduced create_club_team() specifically so that team
-- creation inside an existing org is gated by org membership, not raw table
-- access. The old open policy creates a bypass: a client that is not an org
-- owner/director can still insert teams into arbitrary orgs directly.
--
-- Both creation RPCs (create_team, create_club_team) are SECURITY DEFINER and
-- bypass RLS entirely, so this change does not affect any legitimate code path.
-- Direct client inserts are now limited to org admins only.

DROP POLICY IF EXISTS "Teams insertable by authenticated users" ON teams;

CREATE POLICY "Teams insertable by org admins"
  ON teams FOR INSERT
  WITH CHECK (is_org_admin(organization_id));
