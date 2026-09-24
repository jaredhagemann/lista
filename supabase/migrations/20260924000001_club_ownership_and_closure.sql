-- BUG-013, parts 2 and 3: club ownership transfer, recovery, and closure.
--
-- An owner could delete their account, or their own owner row, and leave an
-- active club with nobody responsible for it; and the only way to end a club was
-- to delete it outright. Decisions (2026-09-24, recorded on the ticket):
--
--   Ownership
--   - goes only to an existing director, who must accept; one pending transfer
--     at a time, cancellable by the owner, expiring after 14 days
--   - the previous owner becomes a director; their teams stay theirs
--   - support can move it to a director when the owner has lost access
--   - an open club always has an owner (checked at commit)
--
--   Closure (D7: archive, never erase)
--   - the owner closes the club, confirming with its name
--   - its roster, events, availability and chat stay readable by its members,
--     and nothing in it can change
--   - pending invitations and transfers are revoked; the subdomain is released
--     through the usual 180-day quarantine and the custom domain removed
--   - support can reopen it
--   - the policy that let an owner delete the club outright is dropped
--
-- The functions that act for a user take the user's id from the API route,
-- which authenticates the request; no client role may execute them.

-- ── 1. Closed clubs ──────────────────────────────────────────────────────────

alter table organizations
  add column closed_at timestamptz,
  add column closed_by uuid references profiles(id) on delete set null;

-- Closing archives a club; nothing deletes one from a client any more.
drop policy "Orgs deletable by org owner" on organizations;

create or replace function club_is_closed(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from organizations where id = p_org_id and closed_at is not null);
$$;

-- ── 2. Read-only once closed ─────────────────────────────────────────────────

-- The club a row belongs to, from the row as JSON. `kind` says how to reach it.
create or replace function club_of_row(kind text, r jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if r is null then
    return null;
  end if;
  case kind
    when 'organization' then
      v_org := (r->>'organization_id')::uuid;
    when 'team' then
      select organization_id into v_org from teams where id = (r->>'team_id')::uuid;
    when 'event' then
      select t.organization_id into v_org
      from events e join teams t on t.id = e.team_id
      where e.id = (r->>'event_id')::uuid;
    when 'channel' then
      select t.organization_id into v_org
      from channels c join teams t on t.id = c.team_id
      where c.id = (r->>'channel_id')::uuid;
    when 'message' then
      if r->>'channel_id' is not null then
        select t.organization_id into v_org
        from channels c join teams t on t.id = c.team_id
        where c.id = (r->>'channel_id')::uuid;
      else
        select t.organization_id into v_org
        from dm_channels d join teams t on t.id = d.team_id
        where d.id = (r->>'dm_channel_id')::uuid;
      end if;
    when 'invitation' then
      v_org := coalesce(
        (r->>'organization_id')::uuid,
        (select organization_id from teams where id = (r->>'team_id')::uuid)
      );
  end case;
  return v_org;
end;
$$;

-- One trigger on every club table, rather than a clause in every policy, so no
-- path can write into a closed club: not a policy someone forgets, not a
-- SECURITY DEFINER function, and not an API route writing with the service role
-- on a user's behalf. What gets through:
--   - direct database sessions with no API token: support in the SQL editor,
--     and the auth service deleting an account
--   - cascades (pg_trigger_depth() > 1), such as an account deletion's
--   - the closure functions below, which set lista.club_admin for their
--     transaction
-- A row moved between clubs is checked on both sides.
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

  if (tg_op <> 'DELETE' and club_is_closed(club_of_row(tg_argv[0], to_jsonb(new))))
     or (tg_op <> 'INSERT' and club_is_closed(club_of_row(tg_argv[0], to_jsonb(old)))) then
    raise exception 'CLUB_CLOSED: this club is closed; its history is read-only' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger teams_refuse_closed_club_write
  before insert or update or delete on teams
  for each row execute function refuse_closed_club_write('organization');
create trigger organization_members_refuse_closed_club_write
  before insert or update or delete on organization_members
  for each row execute function refuse_closed_club_write('organization');
create trigger team_members_refuse_closed_club_write
  before insert or update or delete on team_members
  for each row execute function refuse_closed_club_write('team');
create trigger events_refuse_closed_club_write
  before insert or update or delete on events
  for each row execute function refuse_closed_club_write('team');
create trigger availability_refuse_closed_club_write
  before insert or update or delete on availability
  for each row execute function refuse_closed_club_write('event');
create trigger channels_refuse_closed_club_write
  before insert or update or delete on channels
  for each row execute function refuse_closed_club_write('team');
create trigger channel_members_refuse_closed_club_write
  before insert or update or delete on channel_members
  for each row execute function refuse_closed_club_write('channel');
create trigger dm_channels_refuse_closed_club_write
  before insert or update or delete on dm_channels
  for each row execute function refuse_closed_club_write('team');
create trigger messages_refuse_closed_club_write
  before insert or update or delete on messages
  for each row execute function refuse_closed_club_write('message');
create trigger locations_refuse_closed_club_write
  before insert or update or delete on locations
  for each row execute function refuse_closed_club_write('team');
create trigger invitations_refuse_closed_club_write
  before insert or update or delete on invitations
  for each row execute function refuse_closed_club_write('invitation');
create trigger training_categories_refuse_closed_club_write
  before insert or update or delete on training_categories
  for each row execute function refuse_closed_club_write('team');
create trigger training_sessions_refuse_closed_club_write
  before insert or update or delete on training_sessions
  for each row execute function refuse_closed_club_write('team');

-- ── 3. Ownership transfers ───────────────────────────────────────────────────

create table organization_ownership_transfers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  from_profile_id uuid references profiles(id) on delete set null,
  to_profile_id   uuid references profiles(id) on delete set null,
  status          text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'recovered')),
  -- Why support moved ownership, for a 'recovered' row.
  reason          text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '14 days',
  responded_at    timestamptz
);

create unique index organization_ownership_transfers_one_pending
  on organization_ownership_transfers (organization_id)
  where status = 'pending';

alter table organization_ownership_transfers enable row level security;

-- The owner and the club's directors (the only possible recipients) can see
-- them. Every write goes through the functions below.
create policy "Club admins can view ownership transfers"
  on organization_ownership_transfers for select
  using (is_org_admin(organization_id));

-- Swap owner and director inside one transaction; the unique owner index is
-- satisfied statement by statement, and the owner check (section 4) at commit.
create or replace function swap_club_owner(p_org_id uuid, p_from uuid, p_to uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update organization_members set role = 'director'
  where organization_id = p_org_id and profile_id = p_from and role = 'owner';
  update organization_members set role = 'owner'
  where organization_id = p_org_id and profile_id = p_to and role = 'director';
$$;

revoke execute on function swap_club_owner(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function start_ownership_transfer(p_actor_id uuid, p_org_id uuid, p_to_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform 1 from organizations where id = p_org_id for update;

  if not exists (
    select 1 from organization_members
    where organization_id = p_org_id and profile_id = p_actor_id and role = 'owner'
  ) then
    raise exception 'NOT_AUTHORIZED: only the club owner can transfer ownership' using errcode = '42501';
  end if;
  if club_is_closed(p_org_id) then
    raise exception 'CLUB_CLOSED: this club is closed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
    where organization_id = p_org_id and profile_id = p_to_profile_id and role = 'director'
  ) then
    raise exception 'NOT_A_DIRECTOR: ownership can only go to a director of this club' using errcode = 'P0002';
  end if;

  update organization_ownership_transfers
  set status = 'expired'
  where organization_id = p_org_id and status = 'pending' and expires_at <= now();

  if exists (select 1 from organization_ownership_transfers where organization_id = p_org_id and status = 'pending') then
    raise exception 'TRANSFER_PENDING: cancel the pending transfer first' using errcode = '23505';
  end if;

  insert into organization_ownership_transfers (organization_id, from_profile_id, to_profile_id)
  values (p_org_id, p_actor_id, p_to_profile_id)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function cancel_ownership_transfer(p_actor_id uuid, p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t organization_ownership_transfers%rowtype;
begin
  select * into t from organization_ownership_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'TRANSFER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from organization_members
    where organization_id = t.organization_id and profile_id = p_actor_id and role = 'owner'
  ) then
    raise exception 'NOT_AUTHORIZED: only the club owner can cancel a transfer' using errcode = '42501';
  end if;
  if t.status <> 'pending' then
    raise exception 'TRANSFER_NOT_PENDING' using errcode = '22023';
  end if;

  update organization_ownership_transfers
  set status = 'cancelled', responded_at = now()
  where id = t.id;
end;
$$;

create or replace function respond_ownership_transfer(p_actor_id uuid, p_transfer_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t organization_ownership_transfers%rowtype;
begin
  select * into t from organization_ownership_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'TRANSFER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if t.to_profile_id is distinct from p_actor_id then
    raise exception 'NOT_AUTHORIZED: this transfer is not addressed to you' using errcode = '42501';
  end if;
  if t.status <> 'pending' then
    raise exception 'TRANSFER_NOT_PENDING' using errcode = '22023';
  end if;
  if t.expires_at <= now() then
    raise exception 'TRANSFER_EXPIRED' using errcode = '22023';
  end if;
  if club_is_closed(t.organization_id) then
    raise exception 'CLUB_CLOSED: this club is closed' using errcode = '42501';
  end if;

  if p_accept then
    -- Both still as they were when the transfer began.
    if not exists (
      select 1 from organization_members
      where organization_id = t.organization_id and profile_id = t.from_profile_id and role = 'owner'
    ) or not exists (
      select 1 from organization_members
      where organization_id = t.organization_id and profile_id = t.to_profile_id and role = 'director'
    ) then
      raise exception 'TRANSFER_STALE: ownership or directorship changed since this transfer began'
        using errcode = '22023';
    end if;
    perform swap_club_owner(t.organization_id, t.from_profile_id, t.to_profile_id);
  end if;

  update organization_ownership_transfers
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = now()
  where id = t.id;

  return jsonb_build_object(
    'organization_id', t.organization_id,
    'from_profile_id', t.from_profile_id,
    'to_profile_id', t.to_profile_id,
    'accepted', p_accept
  );
end;
$$;

-- Support's path when the owner has lost access (docs/runbooks/club-owner-recovery.md).
-- Runs from a direct database session or the recovery script, never a client.
create or replace function recover_club_ownership(p_org_id uuid, p_to_profile_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_id uuid;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: record why ownership is being recovered' using errcode = '22023';
  end if;

  perform set_config('lista.club_admin', 'on', true);

  select profile_id into v_owner
  from organization_members
  where organization_id = p_org_id and role = 'owner'
  for update;

  if not exists (
    select 1 from organization_members
    where organization_id = p_org_id and profile_id = p_to_profile_id and role = 'director'
  ) then
    raise exception 'NOT_A_DIRECTOR: ownership can only go to a director of this club' using errcode = 'P0002';
  end if;

  update organization_ownership_transfers
  set status = 'cancelled', responded_at = now()
  where organization_id = p_org_id and status = 'pending';

  if v_owner is not null then
    perform swap_club_owner(p_org_id, v_owner, p_to_profile_id);
  else
    update organization_members set role = 'owner'
    where organization_id = p_org_id and profile_id = p_to_profile_id;
  end if;

  insert into organization_ownership_transfers
    (organization_id, from_profile_id, to_profile_id, status, reason, responded_at)
  values (p_org_id, v_owner, p_to_profile_id, 'recovered', btrim(p_reason), now())
  returning id into v_id;

  return jsonb_build_object('transfer_id', v_id, 'previous_owner_id', v_owner);
end;
$$;

revoke execute on function start_ownership_transfer(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function cancel_ownership_transfer(uuid, uuid) from public, anon, authenticated;
revoke execute on function respond_ownership_transfer(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function recover_club_ownership(uuid, uuid, text) from public, anon, authenticated;

-- ── 4. An open club always has an owner ──────────────────────────────────────

-- Checked at commit, so a transfer can swap roles within its transaction. Only
-- a change to the owner's own row is checked: clubs that predate this rule and
-- have no owner row are not blocked from other changes. A club being deleted
-- (its row already gone by now) or closed needs no owner.
create or replace function enforce_club_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role <> 'owner' then
    return null;
  end if;
  if exists (select 1 from organizations where id = old.organization_id and closed_at is null)
     and not exists (
       select 1 from organization_members
       where organization_id = old.organization_id and role = 'owner'
     ) then
    raise exception 'OWNER_REQUIRED: an open club must keep an owner; transfer ownership or close the club first'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger organization_members_keep_owner
  after delete or update on organization_members
  deferrable initially deferred
  for each row execute function enforce_club_owner();

-- ── 5. Closing and reopening ─────────────────────────────────────────────────

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
      subdomain_quarantined_at = case when subdomain is not null then now() else subdomain_quarantined_at end
  where id = p_org_id;

  delete from invitations
  where accepted_at is null
    and (organization_id = p_org_id or team_id in (select id from teams where organization_id = p_org_id));

  update organization_ownership_transfers
  set status = 'cancelled', responded_at = now()
  where organization_id = p_org_id and status = 'pending';
end;
$$;

-- Support only: a closed club's history is intact, so reopening is a flag.
create or replace function reopen_club(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from organization_members where organization_id = p_org_id and role = 'owner') then
    raise exception 'OWNER_REQUIRED: give the club an owner (recover_club_ownership) before reopening it'
      using errcode = '23514';
  end if;
  update organizations set closed_at = null, closed_by = null where id = p_org_id and closed_at is not null;
  if not found then
    raise exception 'CLUB_NOT_CLOSED' using errcode = '22023';
  end if;
end;
$$;

-- Everyone to tell that the club has closed: members with a login, and the
-- guardians of members without one.
create or replace function club_member_emails(p_org_id uuid)
returns table (email text, first_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (lower(p.email)) p.email, p.first_name
  from (
    select tm.profile_id
    from team_members tm join teams t on t.id = tm.team_id
    where t.organization_id = p_org_id
    union
    select pm.manager_id
    from profile_managers pm
    join team_members tm on tm.profile_id = pm.managed_id
    join teams t on t.id = tm.team_id
    where t.organization_id = p_org_id and pm.manager_id <> pm.managed_id
  ) people
  join profiles p on p.id = people.profile_id
  where p.auth_user_id is not null and p.email is not null
  order by lower(p.email);
$$;

revoke execute on function close_club(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function reopen_club(uuid) from public, anon, authenticated;
revoke execute on function club_member_emails(uuid) from public, anon, authenticated;

-- ── 6. Part 1's functions, closure-aware ─────────────────────────────────────

-- As in 20260924000000, plus: a closed club takes no new directors.
create or replace function create_director_invitation(
  p_actor_id uuid,
  p_org_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  if not exists (
    select 1 from organization_members
    where organization_id = p_org_id and profile_id = p_actor_id and role = 'owner'
  ) then
    raise exception 'NOT_AUTHORIZED: only the club owner can invite directors' using errcode = '42501';
  end if;
  if club_is_closed(p_org_id) then
    raise exception 'CLUB_CLOSED: this club is closed' using errcode = '42501';
  end if;

  if exists (
    select 1
    from organization_members om
    join auth.users u on u.id = om.profile_id
    where om.organization_id = p_org_id and lower(btrim(u.email)) = v_email
  ) then
    raise exception 'ALREADY_MEMBER: % is already the owner or a director of this club', v_email
      using errcode = '23505';
  end if;

  -- Asking again sends the same invitation again.
  select id into v_id
  from invitations
  where organization_id = p_org_id
    and role = 'director'
    and accepted_at is null
    and lower(btrim(email)) = v_email
  for update;
  if found then
    return jsonb_build_object('invitation_id', v_id, 'resent', true);
  end if;

  insert into invitations (email, role, organization_id, invited_by)
  values (v_email, 'director', p_org_id, p_actor_id)
  returning id into v_id;

  return jsonb_build_object('invitation_id', v_id, 'resent', false);
end;
$$;

-- As in 20260924000000, plus: refused in a closed club, and a pending transfer
-- to the removed director is cancelled.
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
  if club_is_closed(p_org_id) then
    raise exception 'CLUB_CLOSED: this club is closed' using errcode = '42501';
  end if;

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
