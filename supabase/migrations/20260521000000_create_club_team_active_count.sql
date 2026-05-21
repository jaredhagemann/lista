-- ── create_club_team(): count only ACTIVE teams against team_limit ───────────
-- Spec: docs/specs/club-upgrade-monetization.md → "Team Creation Limits" and
-- "Over-Limit Downgrade".
--
-- The over-limit downgrade UX in the spec advises owners to "archive teams or
-- upgrade" as remedies to a count over the cap. For that to be honest, archived
-- teams must NOT be counted against the limit. Previously this RPC (and the
-- route in 20260519000001_create_club_team_team_limit.sql) counted ALL teams
-- regardless of archived_at; archiving therefore did not free up a slot, which
-- contradicts the spec's banner message ("…archive teams to stay on Free." and
-- "Archive teams or upgrade to Club Large to add more.").
--
-- This migration is a CREATE OR REPLACE of the body in
-- 20260519000001_create_club_team_team_limit.sql; the ONLY change is the new
-- `archived_at IS NULL` filter on the head-count query. POST /api/club/teams
-- adds the equivalent `.is('archived_at', null)` filter so the two enforcement
-- paths stay in lockstep.

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
  -- and is never blocked. Only ACTIVE (non-archived) teams count against the
  -- cap — archiving is a spec-prescribed remedy and must actually free a slot.
  -- Existing teams over the limit (e.g. after a Large → Small downgrade) are
  -- left intact; only the creation of an additional team past the cap is
  -- rejected.
  SELECT team_limit INTO v_team_limit
  FROM organizations
  WHERE id = org_id;

  IF v_team_limit IS NOT NULL THEN
    SELECT count(*) INTO v_team_count
    FROM teams
    WHERE organization_id = org_id
      AND archived_at IS NULL;

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
