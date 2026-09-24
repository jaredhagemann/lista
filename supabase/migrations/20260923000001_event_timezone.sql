-- BUG-010 / decision D5: every event carries its own named timezone.
--
-- Event times were read and shown in whatever zone the editing device or the
-- server happened to be in. An event now records the zone its local times mean
-- (for example 'America/Denver'), defaulting to the team's; the app reads its
-- inputs, shows its times, expands its series and words its notifications in it.
--
--   1. events.timezone, backfilled from the team's zone. Stored instants are never
--      touched; events on a team with no zone stay unset and keep following the
--      team (then the viewer) until someone gives them one.
--   2. A new event without a zone takes the team's at that moment. Later changes
--      to the team's zone never reach existing events. A name Postgres cannot
--      resolve is refused.
--   3. Notification snapshots name the zone, and a zone change is a schedule
--      change (D3): the same wall-clock time in another zone is another time.
--   4. apply_series_edit gives new occurrences the series' zone and can change it.

-- ── 1. Column and backfill ───────────────────────────────────────────────────

alter table events add column timezone text;

comment on column events.timezone is
  'IANA zone the event''s local times are in (BUG-010). Null only for events from before event zones on a team that had none.';

-- Runs before the notification trigger learns about timezones below, so the
-- backfill enqueues nothing. Only the zone is written: start_time and end_time
-- are instants and stay exactly as stored.
update events e
set timezone = t.timezone
from teams t
where e.team_id = t.id
  and e.timezone is null
  and t.timezone is not null
  and exists (select 1 from pg_timezone_names z where z.name = t.timezone);

-- ── 2. Default and validation ────────────────────────────────────────────────

create or replace function events_set_timezone()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.timezone is null then
    select t.timezone into new.timezone from teams t where t.id = new.team_id;
  end if;

  if new.timezone is not null
     and (tg_op = 'INSERT' or new.timezone is distinct from old.timezone)
     and not exists (select 1 from pg_timezone_names z where z.name = new.timezone) then
    raise exception 'INVALID_TIMEZONE: %', new.timezone using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger events_set_timezone
  before insert or update of timezone on events
  for each row
  execute function events_set_timezone();

-- ── 3. Notifications ─────────────────────────────────────────────────────────

create or replace function event_notification_snapshot(e events)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'title', e.title,
    'event_type', e.event_type,
    'start_time', e.start_time,
    'end_time', e.end_time,
    'timezone', e.timezone,
    'arrival_time', e.arrival_time,
    'location_id', e.location_id,
    'location_name', (select l.name from locations l where l.id = e.location_id),
    'is_cancelled', e.is_cancelled
  );
$$;

create or replace function enqueue_event_notification_from_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_now timestamptz := now();
begin
  if tg_op = 'DELETE' then
    -- The whole team is being deleted and its events are cascading away: the
    -- team row is gone by now, so there is nobody to notify and the job would
    -- reference a team that no longer exists.
    if not exists (select 1 from teams t where t.id = old.team_id) then return old; end if;
    -- Already cancelled: the families were told once already (D3).
    if old.is_cancelled then return old; end if;
    -- Over and done with: history, not news.
    if old.end_time < v_now then return old; end if;
    perform enqueue_notification_job(
      old.team_id, old.id, 'deleted', event_notification_snapshot(old)
    );
    return old;
  end if;

  if old.is_cancelled and new.is_cancelled then return new; end if;
  if old.end_time < v_now then return new; end if;

  if new.is_cancelled and not old.is_cancelled then
    v_action := 'cancelled';
  elsif old.is_cancelled and not new.is_cancelled then
    v_action := 'restored';
  elsif new.start_time is distinct from old.start_time
     or new.end_time is distinct from old.end_time
     or new.timezone is distinct from old.timezone
     or new.arrival_time is distinct from old.arrival_time
     or new.location_id is distinct from old.location_id then
    v_action := 'updated';
  else
    -- Title, notes, opponent, results: optional under D3, so the app asks.
    return new;
  end if;

  perform enqueue_notification_job(
    new.team_id, new.id, v_action, event_notification_snapshot(new)
  );
  return new;
end;
$$;

-- ── 4. Series edits ──────────────────────────────────────────────────────────

create or replace function apply_series_edit(p_series_head_id uuid, p_plan jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_team uuid;
  v_head_zone text;
  v_new_head uuid := (p_plan->>'newHeadId')::uuid;
  v_insert_ids uuid[];
  v_outside integer;
begin
  select team_id, timezone into v_team, v_head_zone
  from events
  where id = p_series_head_id and parent_event_id is null and recurrence_rule is not null
  for update;
  if not found then
    raise exception 'SERIES_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not is_team_admin(v_team) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v_new_head is null or p_plan->>'newHeadRule' is null then
    raise exception 'PLAN_INVALID: newHeadId and newHeadRule are required' using errcode = '22023';
  end if;

  perform 1 from events where parent_event_id = p_series_head_id for update;

  select coalesce(array_agg((x->>'id')::uuid), '{}')
  into v_insert_ids
  from jsonb_array_elements(coalesce(p_plan->'inserts', '[]'::jsonb)) x;

  -- Every existing row the plan touches must belong to this series.
  select count(*) into v_outside
  from (
    select (x->>'id')::uuid as id from jsonb_array_elements(coalesce(p_plan->'updates', '[]'::jsonb)) x
    union
    select c::uuid from jsonb_array_elements_text(coalesce(p_plan->'cancels', '[]'::jsonb)) c
    union
    select r::uuid from jsonb_array_elements_text(coalesce(p_plan->'reparent', '[]'::jsonb)) r
    union
    select v_new_head where not (v_new_head = any(v_insert_ids))
  ) refs
  where not exists (
    select 1 from events e
    where e.id = refs.id
      and (e.id = p_series_head_id or e.parent_event_id = p_series_head_id)
  );
  if v_outside > 0 then
    raise exception 'PLAN_OUTSIDE_SERIES: % referenced events are not in this series', v_outside
      using errcode = '22023';
  end if;
  if exists (select 1 from events where id = any(v_insert_ids)) then
    raise exception 'PLAN_INVALID: an inserted id already exists' using errcode = '22023';
  end if;

  -- New occurrences, with no history, in the plan's zone or else the series'.
  insert into events (
    id, team_id, title, event_type, location_id, notes, opponent, home_away, uniform,
    arrival_time, start_time, end_time, timezone, created_by, is_cancelled
  )
  select
    (x->>'id')::uuid,
    v_team,
    x->'fields'->>'title',
    x->'fields'->>'event_type',
    (x->'fields'->>'location_id')::uuid,
    x->'fields'->>'notes',
    x->'fields'->>'opponent',
    x->'fields'->>'home_away',
    x->'fields'->>'uniform',
    (x->'fields'->>'arrival_time')::integer,
    (x->>'start_time')::timestamptz,
    (x->>'end_time')::timestamptz,
    coalesce(x->'fields'->>'timezone', v_head_zone),
    auth.uid(),
    false
  from jsonb_array_elements(coalesce(p_plan->'inserts', '[]'::jsonb)) x;

  -- The new head carries the rule; everything else in the affected range hangs off it.
  update events
  set parent_event_id = null, recurrence_rule = p_plan->>'newHeadRule'
  where id = v_new_head;

  update events
  set parent_event_id = v_new_head, recurrence_rule = null
  where id <> v_new_head
    and (
      id in (select r::uuid from jsonb_array_elements_text(coalesce(p_plan->'reparent', '[]'::jsonb)) r)
      or id = any(v_insert_ids)
    );

  -- In-place changes: only the fields the plan names.
  update events e
  set
    start_time = coalesce((u->>'start_time')::timestamptz, e.start_time),
    end_time = coalesce((u->>'end_time')::timestamptz, e.end_time),
    timezone = case when u->'fields' ? 'timezone' then u->'fields'->>'timezone' else e.timezone end,
    title = case when u->'fields' ? 'title' then u->'fields'->>'title' else e.title end,
    event_type = case when u->'fields' ? 'event_type' then u->'fields'->>'event_type' else e.event_type end,
    location_id = case when u->'fields' ? 'location_id' then (u->'fields'->>'location_id')::uuid else e.location_id end,
    notes = case when u->'fields' ? 'notes' then u->'fields'->>'notes' else e.notes end,
    opponent = case when u->'fields' ? 'opponent' then u->'fields'->>'opponent' else e.opponent end,
    home_away = case when u->'fields' ? 'home_away' then u->'fields'->>'home_away' else e.home_away end,
    uniform = case when u->'fields' ? 'uniform' then u->'fields'->>'uniform' else e.uniform end,
    arrival_time = case when u->'fields' ? 'arrival_time' then (u->'fields'->>'arrival_time')::integer else e.arrival_time end
  from jsonb_array_elements(coalesce(p_plan->'updates', '[]'::jsonb)) u
  where e.id = (u->>'id')::uuid;

  -- Dates dropped from the pattern are cancelled, never deleted.
  update events
  set is_cancelled = true
  where id in (select c::uuid from jsonb_array_elements_text(coalesce(p_plan->'cancels', '[]'::jsonb)) c);

  -- Earlier occurrences stay in the old series, which now ends before the split.
  if p_plan->>'truncateRule' is not null then
    update events set recurrence_rule = p_plan->>'truncateRule' where id = p_series_head_id;
  end if;

  return v_new_head;
end;
$$;
