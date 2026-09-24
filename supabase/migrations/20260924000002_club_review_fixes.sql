-- BUG-013, PR #84 review (docs/reviews/2026-09-24-bug013-review.md).
--
-- A new migration rather than an edit: 20260924000001 has already run on
-- staging, which applies migrations by version.
--
--   1. Closing a club ends a trial the app runs itself. Such a trial has no
--      Stripe subscription for the close route to cancel, and the trial-expiry
--      job would otherwise convert it into a paid one.
--   2. Club membership changes only through the club functions. The policy
--      "org owners can manage org_members" let an owner hand ownership to
--      anyone without acceptance or record, and remove a director without
--      removing their team places. Nothing in the apps writes the table directly.
--   3. A closed club still lets people be removed. Revoking access (roster and
--      chat membership) is not changing the club's history, and D7 keeps
--      removal rules after closure; additions and every other change stay
--      refused.

-- ── 2. No direct membership writes ───────────────────────────────────────────

drop policy "org owners can manage org_members" on organization_members;

-- ── 3. Revocation after closure ──────────────────────────────────────────────

-- As in 20260924000001, plus: removing someone from a roster or a chat stays
-- possible in a closed club, under the same policies as before closure.
create or replace function refuse_closed_club_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is null
     or pg_trigger_depth() > 1
     or current_setting('lista.club_admin', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Revocation: taking someone off a roster or out of a chat.
  if tg_op = 'DELETE' and tg_table_name in ('team_members', 'channel_members') then
    return old;
  end if;

  if (tg_op <> 'DELETE' and club_is_closed(club_of_row(tg_argv[0], to_jsonb(new))))
     or (tg_op <> 'INSERT' and club_is_closed(club_of_row(tg_argv[0], to_jsonb(old)))) then
    raise exception 'CLUB_CLOSED: this club is closed; its history is read-only' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- As in 20260924000001, but it works on a closed club too: removing a director
-- is revocation. Its other writes (handing their teams to the owner, clearing a
-- stranded active team) are part of that removal.
create or replace function remove_org_director(
  p_actor_id uuid,
  p_org_id uuid,
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select profile_id into v_owner
  from organization_members
  where organization_id = p_org_id and role = 'owner'
  for update;
  if v_owner is null or v_owner <> p_actor_id then
    raise exception 'NOT_AUTHORIZED: only the club owner can remove directors' using errcode = '42501';
  end if;

  perform set_config('lista.club_admin', 'on', true);

  -- Only a director: the owner leaves only by transferring ownership.
  delete from organization_members
  where organization_id = p_org_id and profile_id = p_profile_id and role = 'director';
  if not found then
    raise exception 'NOT_A_DIRECTOR' using errcode = 'P0002';
  end if;

  update organization_ownership_transfers
  set status = 'cancelled', responded_at = now()
  where organization_id = p_org_id and to_profile_id = p_profile_id and status = 'pending';

  -- Their teams pass to the owner.
  update teams set owner_id = v_owner
  where organization_id = p_org_id and owner_id = p_profile_id;

  -- The places the directorship gave them; any other role stays.
  delete from team_members tm
  using teams t
  where tm.team_id = t.id
    and t.organization_id = p_org_id
    and tm.profile_id = p_profile_id
    and tm.role = 'director';

  -- An active team they can no longer reach would strand them on it.
  update profiles p
  set active_team_id = null
  where p.id = p_profile_id
    and p.active_team_id in (select id from teams where organization_id = p_org_id)
    and not exists (
      select 1 from team_members tm
      where tm.team_id = p.active_team_id and tm.profile_id = p_profile_id
    );
end;
$$;

-- ── 1. Closing ends an app-run trial ─────────────────────────────────────────

-- As in 20260924000001, plus: a trial with no Stripe subscription is ended, so
-- the trial-expiry job (which selects trialing clubs with none) cannot convert
-- it. A Stripe subscription is cancelled by the close route before this runs.
create or replace function close_club(p_actor_id uuid, p_org_id uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o organizations%rowtype;
begin
  select * into o from organizations where id = p_org_id for update;
  if not found then
    raise exception 'CLUB_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from organization_members
    where organization_id = p_org_id and profile_id = p_actor_id and role = 'owner'
  ) then
    raise exception 'NOT_AUTHORIZED: only the club owner can close the club' using errcode = '42501';
  end if;
  if o.closed_at is not null then
    raise exception 'CLUB_CLOSED: this club is already closed' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(o.name)) then
    raise exception 'NAME_MISMATCH: type the club''s name to confirm' using errcode = '22023';
  end if;

  perform set_config('lista.club_admin', 'on', true);

  update organizations
  set closed_at = now(),
      closed_by = p_actor_id,
      custom_domain = null,
      -- Released as every subdomain is: quarantined, then freed by the daily cron.
      subdomain_status = case when subdomain is not null then 'quarantined' else subdomain_status end,
      subdomain_quarantined_at = case when subdomain is not null then now() else subdomain_quarantined_at end,
      subscription_status = case
        when subscription_status = 'trialing' and stripe_subscription_id is null then 'canceled'
        else subscription_status
      end
  where id = p_org_id;

  delete from invitations
  where accepted_at is null
    and (organization_id = p_org_id or team_id in (select id from teams where organization_id = p_org_id));

  update organization_ownership_transfers
  set status = 'cancelled', responded_at = now()
  where organization_id = p_org_id and status = 'pending';
end;
$$;
