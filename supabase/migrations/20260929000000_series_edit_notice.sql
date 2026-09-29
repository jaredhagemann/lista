-- A series edit is one notice (PR #96 review, P2; docs/specs/email-upgrade.md D11).
--
-- apply_series_edit moves a series to another day by cancelling the old
-- occurrences and inserting new ones. The change trigger fires on update and
-- delete only, so it saw just the cancellations: families were told
-- "Cancelled: Practice — 3 events" and nothing about the new days. A time or
-- place change was a batch of row updates whose first row stood for the rest.
--
-- Now, inside apply_series_edit, the operation's own rows enqueue nothing (a
-- transaction-local flag the trigger checks), and the function enqueues one
-- 'updated' notice for the series: the new head's snapshot, series_changes
-- (the editor's summary of what changed, as the coach confirmed it, cleaned
-- here), and the count of upcoming events it affects.
--
-- enqueue_notification_job isn't callable by signed-in users, so the notice
-- goes through enqueue_series_edit_notice, which only works inside a series
-- edit (the flag) and only for an admin of the series' team.

create or replace function enqueue_series_edit_notice(p_series_head uuid, p_summary jsonb, p_count integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_head events;
  v_changes jsonb;
  v_job uuid;
begin
  if coalesce(current_setting('lista.series_edit', true), 'off') <> 'on' then
    raise exception 'NOT_IN_SERIES_EDIT' using errcode = '42501';
  end if;
  select * into v_head from events where id = p_series_head;
  if not found or not is_team_admin(v_head.team_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- Up to 12 well-formed rows of text, each capped: it's the coach's own
  -- summary, shown escaped, but it's still input.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'field', left(x->>'field', 60),
        'before', left(coalesce(x->>'before', ''), 200),
        'after', left(coalesce(x->>'after', ''), 200)
      )
      order by ord
    ),
    '[]'::jsonb
  )
  into v_changes
  from (
    select x, ord
    from jsonb_array_elements(case when jsonb_typeof(p_summary) = 'array' then p_summary else '[]'::jsonb end)
      with ordinality as t(x, ord)
    where jsonb_typeof(x) = 'object'
      and jsonb_typeof(x->'field') = 'string'
      and (x->'before' is null or jsonb_typeof(x->'before') = 'string')
      and (x->'after' is null or jsonb_typeof(x->'after') = 'string')
    order by ord
    limit 12
  ) rows;

  v_job := enqueue_notification_job(
    v_head.team_id,
    v_head.id,
    'updated',
    event_notification_snapshot(v_head) || jsonb_build_object('series_changes', v_changes)
  );
  update notification_jobs set occurrence_count = greatest(p_count, 1) where id = v_job;
end;
$$;

revoke execute on function enqueue_series_edit_notice(uuid, jsonb, integer) from public, anon;
grant execute on function enqueue_series_edit_notice(uuid, jsonb, integer) to authenticated;

-- As in 20260928000000, but quiet inside a series edit, which sends its own notice.
create or replace function enqueue_event_notification_from_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_now timestamptz := now();
  v_snapshot jsonb;
begin
  if coalesce(current_setting('lista.series_edit', true), 'off') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

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
     or (old.timezone is not null and new.timezone is distinct from old.timezone)
     or new.arrival_time is distinct from old.arrival_time
     or new.location_id is distinct from old.location_id then
    v_action := 'updated';
  else
    -- Title, notes, opponent, results: optional under D3, so the app asks.
    return new;
  end if;

  v_snapshot := event_notification_snapshot(new);
  if v_action = 'updated' then
    v_snapshot := v_snapshot || jsonb_build_object('previous', event_notification_snapshot(old));
  end if;

  perform enqueue_notification_job(new.team_id, new.id, v_action, v_snapshot);
  return new;
end;
$$;

-- As in 20260923000001, but its rows notify nobody and it enqueues one notice.
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

  -- One notice for the operation: the upcoming events in the new pattern (or,
  -- when it only dropped dates, the ones it cancelled), with the editor's
  -- summary of what changed.
  select count(*) into v_count
  from events
  where not is_cancelled
    and end_time >= now()
    and (
      id = any(v_insert_ids)
      or id in (select (u->>'id')::uuid from jsonb_array_elements(coalesce(p_plan->'updates', '[]'::jsonb)) u)
    );
  if v_count = 0 then
    select count(*) into v_count
    from events
    where end_time >= now()
      and id in (select c::uuid from jsonb_array_elements_text(coalesce(p_plan->'cancels', '[]'::jsonb)) c);
  end if;
  if v_count > 0 then
    perform enqueue_series_edit_notice(v_new_head, p_plan->'summary', v_count);
  end if;
  perform set_config('lista.series_edit', 'off', true);

  return v_new_head;
end;
$$;

