-- RPC: create_team
-- Atomically creates an organization, team, team membership, and updates
-- the owner's active_team_id in a single transaction.
--
-- Identity resolution is the caller's responsibility. The server route
-- resolves the auth user and passes the resulting profile ID explicitly.
-- This function treats owner_profile_id as a trusted input and never
-- calls auth.uid() internally.

create or replace function create_team(
  owner_profile_id uuid,
  team_name        text,
  season           text,
  org_name         text
) returns uuid
language plpgsql
security definer
as $$
declare
  v_org_id  uuid := gen_random_uuid();
  v_team_id uuid := gen_random_uuid();
begin
  -- Step 1: Create organization (org name defaults to team name when blank)
  insert into organizations (id, name)
  values (v_org_id, coalesce(nullif(trim(org_name), ''), trim(team_name)));

  -- Step 2: Create team (fires create_team_channel trigger → provisions channels row)
  insert into teams (id, organization_id, name, season, owner_id)
  values (
    v_team_id,
    v_org_id,
    trim(team_name),
    nullif(trim(season), ''),
    owner_profile_id
  );

  -- Step 3: Add owner as coach
  insert into team_members (team_id, profile_id, role)
  values (v_team_id, owner_profile_id, 'coach');

  -- Step 4: Set active team for the owner
  update profiles
  set active_team_id = v_team_id
  where id = owner_profile_id;

  return v_team_id;
end;
$$;
