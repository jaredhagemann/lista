-- BUG-011, historical repair.
--
-- D6 ruled historical repair out of scope on the understanding that no duplicate
-- identities existed — user-provided context, with no production inspection
-- behind it. A check on 2026-09-18 found one: the same child held two managed
-- profiles, each carrying real history (a team, availability responses, training
-- sessions, guardian links) split between them. The premise was wrong, so the
-- repair is in scope after all.
--
-- merge_managed_profiles moves everything onto the surviving record and deletes
-- the other, in one transaction. It is a repair tool, not a feature: it runs as
-- the service role only, and it refuses any profile with its own login, because
-- a person with an account owns it and no merge tool gets to delete them.
--
-- Where both records held the same thing — the same team, an answer to the same
-- event — the survivor's row stands and the duplicate is dropped rather than
-- overwriting it.

create or replace function merge_managed_profiles(p_keep uuid, p_merge uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  keep_row profiles%rowtype;
  merge_row profiles%rowtype;
  v_teams integer;
  v_availability integer;
  v_training integer;
  v_guardians integer;
begin
  if p_keep = p_merge then
    raise exception 'SAME_PROFILE' using errcode = '22023';
  end if;

  select * into keep_row from profiles where id = p_keep for update;
  if not found then
    raise exception 'PROFILE_NOT_FOUND: %', p_keep using errcode = 'P0002';
  end if;
  select * into merge_row from profiles where id = p_merge for update;
  if not found then
    raise exception 'PROFILE_NOT_FOUND: %', p_merge using errcode = 'P0002';
  end if;

  if keep_row.auth_user_id is not null or merge_row.auth_user_id is not null then
    raise exception 'MANAGED_PROFILES_ONLY: a profile with its own login cannot be merged'
      using errcode = '42501';
  end if;

  -- Team memberships, skipping teams the survivor is already on.
  update team_members tm
  set profile_id = p_keep
  where tm.profile_id = p_merge
    and not exists (
      select 1 from team_members k where k.team_id = tm.team_id and k.profile_id = p_keep
    );
  get diagnostics v_teams = row_count;

  -- Availability, skipping events the survivor already answered.
  update availability a
  set profile_id = p_keep
  where a.profile_id = p_merge
    and not exists (
      select 1 from availability k where k.event_id = a.event_id and k.profile_id = p_keep
    );
  get diagnostics v_availability = row_count;

  -- Training sessions are per player and per day, with no uniqueness to respect.
  update training_sessions set profile_id = p_keep where profile_id = p_merge;
  get diagnostics v_training = row_count;

  -- Guardian links, skipping anyone who already manages the survivor.
  update profile_managers pm
  set managed_id = p_keep
  where pm.managed_id = p_merge
    and not exists (
      select 1 from profile_managers k
      where k.manager_id = pm.manager_id and k.managed_id = p_keep
    );
  get diagnostics v_guardians = row_count;

  -- Chat membership, same rule.
  update channel_members cm
  set profile_id = p_keep
  where cm.profile_id = p_merge
    and not exists (
      select 1 from channel_members k
      where k.channel_id = cm.channel_id and k.profile_id = p_keep
    );
  -- Details the survivor was missing; never overwrite what it already had.
  update profiles
  set birthday = coalesce(birthday, merge_row.birthday),
      gender = coalesce(gender, merge_row.gender)
  where id = p_keep;

  -- Whatever did not move is a duplicate of something the survivor already has.
  -- Deleting the profile takes it with them: every one of those tables cascades
  -- from profiles, and the guardian-link trigger deliberately permits removal
  -- once the player row itself is gone (20260917000002), which an explicit
  -- delete here would trip on the last guardian.
  delete from profiles where id = p_merge;

  return jsonb_build_object(
    'kept', p_keep,
    'merged', p_merge,
    'teams_moved', v_teams,
    'availability_moved', v_availability,
    'training_moved', v_training,
    'guardians_moved', v_guardians
  );
end;
$$;

revoke execute on function merge_managed_profiles(uuid, uuid) from public, anon, authenticated;

-- ── The production merge lives in 20260918000003 ────────────────────────────
--
-- This file originally performed the merge here. It failed in production on an
-- invitation still referencing the record being deleted, and the whole migration
-- rolled back, so production never recorded this version while staging did.
-- The merge, and the corrected function, moved to
-- 20260918000003_merge_managed_profiles_references.sql, which both databases
-- reach. The step was removed here rather than fixed in place so that the two
-- end in the same state without a staging reset.
