-- BUG-006: schedule changes told nobody.
--
-- Event mutations finished at the database write. Only the entire-series edit
-- called the notification route, and it ignored the result. Decision D3
-- (docs/reviews/2026-09-15-bug-backlog-review.md) settles which changes notify;
-- this migration makes the enqueue happen in the same transaction as the change,
-- so no UI path — and no RPC, including BUG-009's apply_series_edit and
-- delete_event_occurrence — can forget to do it.
--
--   notification_jobs        one row per operation per team, with a snapshot of
--                            the event so a notice about a *deleted* event can
--                            still describe it
--   notification_deliveries  one row per recipient and channel, so "skipped
--                            because opted out" is recorded apart from "failed"
--
-- The cases a coach cannot suppress (time, arrival time or location change;
-- cancel, restore, delete of an upcoming or in-progress event) are enqueued by
-- a trigger. The suppressible ones (creating an event, a title-only edit) are
-- enqueued by the app through enqueue_event_notification().
--
-- Batching: every row a single transaction touches collapses into one job per
-- team and action, keyed by the transaction id, so a series edit across twelve
-- occurrences produces one notice, not twelve.

-- ── 1. Tables ────────────────────────────────────────────────────────────────

create table notification_jobs (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references teams(id) on delete cascade,
  -- No foreign key: the event may be gone. The snapshot describes it.
  event_id         uuid,
  action           text not null check (action in ('created', 'updated', 'cancelled', 'restored', 'deleted')),
  snapshot         jsonb not null,
  occurrence_count integer not null default 1,
  status           text not null default 'pending'
                     check (status in ('pending', 'sending', 'sent', 'partial', 'failed')),
  attempts         integer not null default 0,
  last_error       text,
  batch_key        text not null unique,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);

create index notification_jobs_pending_idx on notification_jobs (created_at)
  where status in ('pending', 'sending');
create index notification_jobs_team_idx on notification_jobs (team_id, created_at desc);
create index notification_jobs_event_idx on notification_jobs (event_id, created_at desc);

create table notification_deliveries (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references notification_jobs(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  channel    text not null check (channel in ('email', 'push')),
  target     text,
  status     text not null check (status in ('sent', 'failed', 'skipped')),
  reason     text,
  created_at timestamptz not null default now()
);

create index notification_deliveries_job_idx on notification_deliveries (job_id);

alter table notification_jobs enable row level security;
alter table notification_deliveries enable row level security;

-- Status is sender-facing: team admins read it. Writes belong to the database
-- (trigger, RPC) and to the worker's service role, never to a client.
create policy "Team admins can view notification jobs"
  on notification_jobs for select
  using (is_team_admin(team_id));

create policy "Team admins can view notification deliveries"
  on notification_deliveries for select
  using (exists (
    select 1 from notification_jobs j
    where j.id = notification_deliveries.job_id and is_team_admin(j.team_id)
  ));

-- ── 2. Enqueue helpers ───────────────────────────────────────────────────────

-- What the notice can say about an event that may no longer exist.
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
    'arrival_time', e.arrival_time,
    'location_id', e.location_id,
    'location_name', (select l.name from locations l where l.id = e.location_id),
    'is_cancelled', e.is_cancelled
  );
$$;

-- One job per transaction, team and action; later rows in the same operation
-- only raise the count.
create or replace function enqueue_notification_job(
  p_team_id uuid,
  p_event_id uuid,
  p_action text,
  p_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into notification_jobs (team_id, event_id, action, snapshot, batch_key, created_by)
  values (
    p_team_id,
    p_event_id,
    p_action,
    p_snapshot,
    txid_current()::text || ':' || p_team_id::text || ':' || p_action,
    auth.uid()
  )
  on conflict (batch_key) do update
    set occurrence_count = notification_jobs.occurrence_count + 1
  returning id into v_id;

  return v_id;
end;
$$;

-- ── 3. The changes a coach cannot suppress ───────────────────────────────────

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

create trigger events_enqueue_notification
  after update or delete on events
  for each row
  execute function enqueue_event_notification_from_change();

-- ── 4. The changes the coach chooses to send ─────────────────────────────────

-- Creating an event notifies by default and a title-only edit does not; both are
-- the coach's call, so the app enqueues them explicitly.
create or replace function enqueue_event_notification(p_event_id uuid, p_action text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ev events%rowtype;
begin
  if p_action not in ('created', 'updated') then
    raise exception 'UNSUPPORTED_ACTION: %', p_action using errcode = '22023';
  end if;

  select * into ev from events where id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not is_team_admin(ev.team_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if ev.end_time < now() then
    raise exception 'EVENT_NOT_UPCOMING' using errcode = '22023';
  end if;
  if ev.is_cancelled then
    raise exception 'EVENT_CANCELLED' using errcode = '22023';
  end if;

  return enqueue_notification_job(
    ev.team_id, ev.id, p_action, event_notification_snapshot(ev)
  );
end;
$$;

-- Enqueueing is the database's job, not a client's: PUBLIC holds execute by
-- default on a new function, so it has to go too.
revoke execute on function enqueue_notification_job(uuid, uuid, text, jsonb) from public, authenticated, anon;

-- ── 5. The worker's claim ────────────────────────────────────────────────────

-- Claims a batch of jobs for one worker run. A job left 'sending' by a crashed
-- run is picked up again after ten minutes, and one that has failed five times
-- is left alone for a person to look at.
create or replace function claim_notification_jobs(p_limit integer default 20)
returns setof notification_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update notification_jobs j
  set status = 'sending', attempts = j.attempts + 1
  where j.id in (
    select c.id
    from notification_jobs c
    where c.attempts < 5
      and (
        c.status = 'pending'
        or (c.status = 'sending' and c.created_at < now() - interval '10 minutes')
      )
    order by c.created_at
    limit p_limit
    for update skip locked
  )
  returning j.*;
end;
$$;

revoke execute on function claim_notification_jobs(integer) from public, authenticated, anon;
