-- Email upgrade, part 2 (docs/specs/email-upgrade.md §4.3, D11).
--
-- A schedule-change notice is built from its job's snapshot alone, and the
-- emails now show a game's opponent, home/away, uniform and notes, and for an
-- update what changed. So:
--
--   1. The snapshot carries opponent, home_away, uniform and notes.
--   2. An 'updated' job carries the event as it was in snapshot.previous. A
--      bulk series edit keeps one job (enqueue_notification_job only raises the
--      count after the first row), so its previous is the first occurrence's
--      old state, which is what a series edit changes on every occurrence.
--
-- Jobs queued before this have neither, and the worker renders them as before.

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
    'is_cancelled', e.is_cancelled,
    'opponent', e.opponent,
    'home_away', e.home_away,
    'uniform', e.uniform,
    'notes', e.notes
  );
$$;

-- As in 20260923000002, but an update's snapshot also records `previous`.
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
