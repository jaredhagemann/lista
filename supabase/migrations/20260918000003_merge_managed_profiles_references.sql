-- BUG-011 follow-up: the merge failed in production.
--
-- 20260918000002 created merge_managed_profiles and then merged the duplicate
-- "Finley Hagemann" records. The production run failed:
--
--   ERROR: update or delete on table "profiles" violates foreign key constraint
--   "invitations_managed_profile_id_fkey" on table "invitations" (SQLSTATE 23503)
--   Key (id)=(a37d29b9-…) is still referenced from table "invitations".
--
-- A guardian invitation still named the record being merged away. Most tables
-- referencing profiles cascade, so deleting the profile cleared them; invitations
-- does not, by design — an invitation is a record of something that happened, and
-- deleting a person should not quietly erase it.
--
-- The migration ran in a transaction, so production rolled the whole thing back:
-- no function, no merge, and 20260918000002 was never recorded there. Staging did
-- record it, because the merge was a no-op with those ids absent. This migration
-- therefore redefines the function for both, and runs the merge for whichever
-- database still has the duplicate.
--
-- The function now repoints every reference that does not cascade, rather than
-- relying on the delete to clear them:
--
--   invitations.managed_profile_id   the one that failed
--   invitations.invited_by           an adult in practice, repointed for safety
--   events.created_by                same
--   organizations.created_by         same
--   training_categories.created_by   same
--   training_sessions.created_by     same
--
-- Everything else referencing profiles is ON DELETE CASCADE or SET NULL, and is
-- still cleared by the delete.

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
  v_invitations integer;
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

  -- References that do not cascade. An invitation naming this child is a record
  -- of something that happened: it follows the child rather than blocking the
  -- merge or being deleted with them.
  update invitations set managed_profile_id = p_keep where managed_profile_id = p_merge;
  get diagnostics v_invitations = row_count;

  -- A managed profile has no login, so it should never appear as an author. If
  -- one somehow does, the reference moves rather than stopping the merge.
  update invitations set invited_by = p_keep where invited_by = p_merge;
  update events set created_by = p_keep where created_by = p_merge;
  update organizations set created_by = p_keep where created_by = p_merge;
  update training_categories set created_by = p_keep where created_by = p_merge;
  update training_sessions set created_by = p_keep where created_by = p_merge;

  -- Details the survivor was missing; never overwrite what it already had.
  update profiles
  set birthday = coalesce(birthday, merge_row.birthday),
      gender = coalesce(gender, merge_row.gender)
  where id = p_keep;

  -- Whatever did not move is a duplicate of something the survivor already has.
  -- Deleting the profile takes it with them: those tables cascade from profiles,
  -- and the guardian-link trigger deliberately permits removal once the player
  -- row itself is gone (20260917000002), which an explicit delete would trip on
  -- the last guardian.
  delete from profiles where id = p_merge;

  return jsonb_build_object(
    'kept', p_keep,
    'merged', p_merge,
    'teams_moved', v_teams,
    'availability_moved', v_availability,
    'training_moved', v_training,
    'guardians_moved', v_guardians,
    'invitations_moved', v_invitations
  );
end;
$$;

revoke execute on function merge_managed_profiles(uuid, uuid) from public, anon, authenticated;

-- ── The duplicate found in production, 2026-09-18 ───────────────────────────
--
-- Repeated here because 20260918000002 rolled back in production, so its merge
-- never ran. Guarded by existence checks on both ids: a no-op once the merge has
-- happened, and on every database that never had them.
do $$
begin
  if exists (select 1 from profiles where id = '8c5cd6ce-0b3b-4d7a-9782-53430c14f952')
     and exists (select 1 from profiles where id = 'a37d29b9-b62a-49c4-90e7-9b8396a6fa81')
  then
    perform merge_managed_profiles(
      '8c5cd6ce-0b3b-4d7a-9782-53430c14f952',
      'a37d29b9-b62a-49c4-90e7-9b8396a6fa81'
    );
  end if;
end
$$;
