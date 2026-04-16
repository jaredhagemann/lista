-- ── Update create_team() RPC ──────────────────────────────────────────────────
-- Adds Step 5: insert the creator as 'owner' into organization_members.
-- This ensures every new org created via this RPC has a corresponding owner row
-- from creation time, consistent with the backfill in migration 000003.
--
-- Security: revoke execute from all client roles; grant only to service_role.
-- The function accepts a caller-supplied owner_profile_id (trusted input) so it
-- cannot resolve ownership from auth.uid() — the server route calls it via the
-- service-role adminClient() and is responsible for passing the correct profile.
-- Revoking client access prevents an authenticated user from forging a call with
-- another profile's UUID.

CREATE OR REPLACE FUNCTION create_team(
  owner_profile_id uuid,
  team_name        text,
  season           text,
  org_name         text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id  uuid := gen_random_uuid();
  v_team_id uuid := gen_random_uuid();
  v_slug    text;
BEGIN
  -- Generate slug from org name (same logic as the backfill migration)
  v_slug := TRIM(BOTH '-' FROM
    SUBSTRING(
      LOWER(REGEXP_REPLACE(
        COALESCE(NULLIF(TRIM(org_name), ''), TRIM(team_name)),
        '[^a-zA-Z0-9]+', '-', 'g'
      )),
      1, 48
    )
  );

  -- Deduplicate slug if already taken (append _2, _3, ...)
  WHILE EXISTS (SELECT 1 FROM organizations WHERE slug = v_slug) LOOP
    v_slug := v_slug || '_2';
    -- For collisions beyond _2, append a random suffix to guarantee uniqueness
    IF LENGTH(v_slug) > 50 THEN
      v_slug := SUBSTRING(v_slug, 1, 44) || '_' || SUBSTRING(gen_random_uuid()::text, 1, 4);
    END IF;
  END LOOP;

  -- Step 1: Create organization
  INSERT INTO organizations (id, name, slug, created_by)
  VALUES (
    v_org_id,
    COALESCE(NULLIF(TRIM(org_name), ''), TRIM(team_name)),
    v_slug,
    owner_profile_id
  );

  -- Step 2: Create team (fires create_team_channel trigger → provisions channels row)
  INSERT INTO teams (id, organization_id, name, season, owner_id)
  VALUES (
    v_team_id,
    v_org_id,
    TRIM(team_name),
    NULLIF(TRIM(season), ''),
    owner_profile_id
  );

  -- Step 3: Add owner as coach in team_members
  INSERT INTO team_members (team_id, profile_id, role)
  VALUES (v_team_id, owner_profile_id, 'coach');

  -- Step 4: Set active team for the owner
  UPDATE profiles
  SET active_team_id = v_team_id
  WHERE id = owner_profile_id;

  -- Step 5: Register the creator as org owner in organization_members
  INSERT INTO organization_members (organization_id, profile_id, role)
  VALUES (v_org_id, owner_profile_id, 'owner');

  RETURN v_team_id;
END;
$$;

-- Revoke execute from all client-accessible roles so authenticated users cannot
-- call this function directly via .rpc(). Only the service_role (used by the
-- server-side adminClient()) retains execute permission.
REVOKE EXECUTE ON FUNCTION create_team(uuid, text, text, text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION create_team(uuid, text, text, text) TO service_role;
