-- ── Enforce per-org team_limit in create_club_team() ─────────────────────────
-- Spec: docs/specs/club-upgrade-monetization.md → "Team Creation Limits".
--
-- The plan caps how many teams an org may hold (free = 1, club_small = 10,
-- club_large = NULL / unlimited). This cap is per-ORG, not per-user, so it
-- cannot live in an RLS policy (RLS predicates are evaluated per-row for the
-- calling user and have no clean way to express "count of sibling rows in the
-- same org"). It is therefore enforced in two places: this SECURITY DEFINER
-- RPC and the POST /api/club/teams route. Both must agree.
--
-- Rule (spec):
--   1. Count current teams for the org.
--   2. If team_limit IS NOT NULL and count >= team_limit, reject.
--   3. Message: "You've reached your plan limit of X teams."
--
-- Existing teams above the limit (e.g. after a Large → Small downgrade) are
-- never touched — only the creation of an additional team is blocked.
--
-- This is a CREATE OR REPLACE of the body from 20260416000005; the only change
-- is the limit check inserted between the role verification and the INSERT.

CREATE OR REPLACE FUNCTION create_club_team(
  org_id    uuid,
  team_name text,
  season    text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_team_id      uuid := gen_random_uuid();
  v_profile_id   uuid;
  v_caller_role  text;
  v_team_limit   integer;
  v_team_count   integer;
BEGIN
  -- Resolve caller's profile from auth.uid()
  SELECT id INTO v_profile_id
  FROM profiles
  WHERE auth_user_id = auth.uid();

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Verify caller is an owner or director in the target org
  SELECT role INTO v_caller_role
  FROM organization_members
  WHERE organization_id = org_id
    AND profile_id = v_profile_id;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'director') THEN
    RAISE EXCEPTION 'caller is not an owner or director of this organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Enforce the per-org team limit. A NULL limit (club_large) means unlimited
  -- and is never blocked. Existing teams over the limit are left intact; only
  -- the creation of an additional team past the cap is rejected.
  SELECT team_limit INTO v_team_limit
  FROM organizations
  WHERE id = org_id;

  IF v_team_limit IS NOT NULL THEN
    SELECT count(*) INTO v_team_count
    FROM teams
    WHERE organization_id = org_id;

    IF v_team_count >= v_team_limit THEN
      RAISE EXCEPTION 'You''ve reached your plan limit of % teams.', v_team_limit;
    END IF;
  END IF;

  -- Create the team (fires create_team_channel trigger → provisions channels row)
  INSERT INTO teams (id, organization_id, name, season, owner_id)
  VALUES (
    v_team_id,
    org_id,
    TRIM(team_name),
    NULLIF(TRIM(season), ''),
    v_profile_id
  );

  -- Add the creating director to team_members so they appear in the roster,
  -- receive team notifications, and have access to team chat.
  INSERT INTO team_members (team_id, profile_id, role)
  VALUES (v_team_id, v_profile_id, 'director');

  -- Update caller's active team
  UPDATE profiles
  SET active_team_id = v_team_id
  WHERE id = v_profile_id;

  RETURN v_team_id;
END;
$$;
