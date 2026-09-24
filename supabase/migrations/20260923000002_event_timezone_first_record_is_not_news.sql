-- BUG-010, PR #81 review: recording a zone on an event that had none is not news.
--
-- 20260923000001 made any change to events.timezone an 'updated' notice. An event
-- from before event zones has none, and the event editor records the zone it was
-- shown in when it is saved — so a title-only edit became a schedule-change
-- notice although nobody's view of the event changed. Only a change from one
-- zone to another is a schedule change.
--
-- A separate migration rather than an edit to 20260923000001: that version has
-- already run on staging, which applies migrations by version.

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
     or (old.timezone is not null and new.timezone is distinct from old.timezone)
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
