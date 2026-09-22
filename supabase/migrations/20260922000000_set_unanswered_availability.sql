-- ============================================================
-- Bulk availability across unloaded pages (BUG-014, spec §8.2)
-- ============================================================
-- "Set my unanswered events to Available" used to mean whatever the browser had
-- loaded. Now that the matrix reads one page at a time, that would silently
-- shrink to ten events, so the selection moves to the database: the caller
-- names a window and an optional event type, and the server decides which
-- events qualify.
--
-- The design constraints, and why each one is here:
--
--   * security invoker, so the existing availability policies still decide
--     every row. This function is a scope, not an escalation, and it must not
--     become a way to write rows the caller could not write one at a time.
--   * it only ever fills in blanks. `on conflict do nothing` plus the
--     `not exists` guard means an answer already given is never overwritten —
--     including one saved from another device a second ago, which is the race
--     this action is most likely to lose.
--   * one statement, one transaction. A failure leaves nothing half-written,
--     unlike the browser loop it replaces.
--   * "future" is decided here, against database time, not against a clock the
--     caller chose.

create or replace function set_unanswered_availability(
  p_team_id uuid,
  p_profile_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_status text,
  p_event_type text default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_inserted integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_status is null or p_status not in ('available', 'maybe', 'unavailable') then
    raise exception 'Unsupported availability status: %', p_status using errcode = '22023';
  end if;

  if p_event_type is not null and p_event_type not in ('practice', 'game', 'other') then
    raise exception 'Unsupported event type: %', p_event_type using errcode = '22023';
  end if;

  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'Window start must be before window end' using errcode = '22023';
  end if;

  -- The widest window the UI offers is a year either side of its anchor. A
  -- request far beyond that did not come from the window control, and a bulk
  -- write is not the place to find out what else it might have meant.
  if p_to - p_from > interval '800 days' then
    raise exception 'Window is wider than any selectable range' using errcode = '22023';
  end if;

  -- Acting for yourself, or for a player you manage. Coaching the team is not
  -- permission to answer on someone else's behalf (spec §8.1), and the active
  -- profile cookie is not consulted: only the session's own identity is.
  if p_profile_id <> auth.uid() and not is_managed_by_me(p_profile_id) then
    raise exception 'Not permitted to answer for this profile' using errcode = '42501';
  end if;

  -- Availability belongs to a roster member of the event's team, matching the
  -- row policy that would reject these inserts one at a time.
  if not exists (
    select 1 from team_members
    where team_id = p_team_id and profile_id = p_profile_id
  ) then
    raise exception 'Profile is not a member of this team' using errcode = '42501';
  end if;

  insert into availability (event_id, profile_id, status)
  select e.id, p_profile_id, p_status
  from events e
  where e.team_id = p_team_id
    -- Database time, evaluated now: an event that started while the
    -- confirmation dialog was open is no longer a future event.
    and e.start_time >= greatest(p_from, now())
    and e.start_time < p_to
    -- Events predating the cancellation column have no flag, not a true one.
    and coalesce(e.is_cancelled, false) = false
    and (p_event_type is null or e.event_type = p_event_type)
    and not exists (
      select 1 from availability a
      where a.event_id = e.id
        and a.profile_id = p_profile_id
    )
  on conflict (event_id, profile_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- PUBLIC holds execute on a new function by default, which would include the
-- anon role. Only a signed-in caller has an auth.uid() to check.
revoke execute on function set_unanswered_availability(uuid, uuid, timestamptz, timestamptz, text, text) from public;
grant execute on function set_unanswered_availability(uuid, uuid, timestamptz, timestamptz, text, text) to authenticated;

comment on function set_unanswered_availability(uuid, uuid, timestamptz, timestamptz, text, text) is
  'Fills in unanswered future responses for one profile across a window and optional event type (BUG-014, spec §8.2). Never overwrites an existing response.';
