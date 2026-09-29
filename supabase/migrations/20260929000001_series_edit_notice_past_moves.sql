-- PR #96 re-review: a series edit that moves its last upcoming occurrences
-- into the past notified nobody.
--
-- 20260929000000 counted the edit's upcoming events after applying it. Moving
-- the last upcoming occurrence to a time that has already ended left none,
-- and with the rows' own notices quieted, nothing was queued. Now, when the new
-- pattern has no upcoming events, the count falls back to the upcoming events
-- the edit touched as they were before it.
--
-- A separate migration rather than an edit to 20260929000000: that version has
-- already run on staging, which applies migrations by version.

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
  v_count integer;
  v_upcoming_before integer;
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

  -- This operation's own rows notify nobody: it sends one notice below.
  perform set_config('lista.series_edit', 'on', true);

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

  -- The upcoming events the edit touches, as they are before it: an edit that
  -- moves them into the past still changed events families expected.
  select count(*) into v_upcoming_before
  from events
  where end_time >= now()
    and id in (
      select (u->>'id')::uuid from jsonb_array_elements(coalesce(p_plan->'updates', '[]'::jsonb)) u
      union
      select c::uuid from jsonb_array_elements_text(coalesce(p_plan->'cancels', '[]'::jsonb)) c
    );

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

  -- One notice for the operation, with the editor's summary of what changed.
  -- Its count: the upcoming events in the new pattern, or, when none are (it
  -- dropped dates, or moved the last ones into the past), the upcoming events
  -- it touched as they were before.
  select count(*) into v_count
  from events
  where not is_cancelled
    and end_time >= now()
    and (
      id = any(v_insert_ids)
      or id in (select (u->>'id')::uuid from jsonb_array_elements(coalesce(p_plan->'updates', '[]'::jsonb)) u)
    );
  if v_count = 0 then
    v_count := v_upcoming_before;
  end if;
  if v_count > 0 then
    perform enqueue_series_edit_notice(v_new_head, p_plan->'summary', v_count);
  end if;
  perform set_config('lista.series_edit', 'off', true);

  return v_new_head;
end;
$$;
