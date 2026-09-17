-- BUG-009: editing or deleting part of a recurring series destroyed history.
-- Decision D4 (docs/reviews/2026-09-15-bug-backlog-review.md) and the
-- implementation decisions recorded on the ticket, 2026-09-17.
--
-- A series is a head event carrying recurrence_rule, plus children pointing at it
-- through parent_event_id.
--
--   1. parent_event_id was ON DELETE CASCADE, so deleting the head — the first
--      occurrence, via "Delete this event" — deleted every occurrence and, through
--      availability's own cascade, every response. It is now NO ACTION: a head
--      with children cannot be deleted directly. Deleting whole teams still works,
--      because the constraint is checked at the end of the statement.
--   2. delete_event_occurrence deletes one occurrence, promoting the next one to
--      head when the head itself is deleted.
--   3. delete_event_series deletes a whole series, as a separate, explicit action.
--   4. apply_series_edit applies a series edit planned in the app
--      (apps/web/src/lib/events/series-edit.ts) in one transaction. The editor
--      used to delete every child and re-insert fresh rows in separate requests.
--
-- All three functions run with the caller's privileges, so the existing events
-- RLS policies still apply; each also checks team admin explicitly for a clear
-- error.

-- ── 1. No cascading delete from the head ─────────────────────────────────────

alter table events drop constraint events_parent_event_id_fkey;
alter table events
  add constraint events_parent_event_id_fkey
  foreign key (parent_event_id) references events(id);

-- ── 2. Delete one occurrence ─────────────────────────────────────────────────

create or replace function delete_event_occurrence(
  p_event_id uuid,
  p_promoted_head_rule text default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  ev events%rowtype;
  v_next uuid;
begin
  select * into ev from events where id = p_event_id for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not is_team_admin(ev.team_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- Deleting the head: the next occurrence carries the series on. The app passes
  -- the rule with DTSTART pinned to the original pattern start.
  if ev.parent_event_id is null then
    select id into v_next
    from events
    where parent_event_id = ev.id
    order by start_time
    limit 1
    for update;

    if v_next is not null then
      update events
      set parent_event_id = null,
          recurrence_rule = coalesce(p_promoted_head_rule, ev.recurrence_rule)
      where id = v_next;

      update events set parent_event_id = v_next where parent_event_id = ev.id;
    end if;
  end if;

  delete from events where id = p_event_id;
end;
$$;

-- ── 3. Delete a whole series ─────────────────────────────────────────────────

create or replace function delete_event_series(p_event_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_head uuid;
  v_team uuid;
  v_children integer;
begin
  select coalesce(parent_event_id, id), team_id into v_head, v_team
  from events where id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not is_team_admin(v_team) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  delete from events where parent_event_id = v_head;
  get diagnostics v_children = row_count;
  delete from events where id = v_head;
  return v_children + 1;
end;
$$;

-- ── 4. Apply a planned series edit atomically ────────────────────────────────

create or replace function apply_series_edit(p_series_head_id uuid, p_plan jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_team uuid;
  v_new_head uuid := (p_plan->>'newHeadId')::uuid;
  v_insert_ids uuid[];
  v_outside integer;
begin
  select team_id into v_team
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

  -- New occurrences, with no history.
  insert into events (
    id, team_id, title, event_type, location_id, notes, opponent, home_away, uniform,
    arrival_time, start_time, end_time, created_by, is_cancelled
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
