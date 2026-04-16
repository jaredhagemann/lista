-- ── create_club_team() RPC ────────────────────────────────────────────────────
-- Creates a new team within an existing org (club path).
-- Does NOT create a new organization.
--
-- Caller must be 'owner' or 'director' in organization_members for the target
-- org — raises insufficient_privilege otherwise.
--
-- On success:
--   - Inserts into teams with owner_id = caller's profile ID
--   - Adds caller to team_members as 'director'
--   - Updates profiles.active_team_id to the new team
--
-- Other directors in the org are NOT auto-enrolled in team_members for the
-- new team. They gain access via the is_org_admin() check in is_team_member().
-- Only the creating director gets an explicit row (so they appear in the
-- roster, receive notifications, and have team chat access).

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
