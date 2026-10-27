-- Reminders that fail are tried again (reminder-rules review RR-001).
--
-- The reminders job keys each reminder's log row on the event and its start
-- time, so a rerun sends nothing twice. Until now a rerun found the row and
-- stopped there, whatever had happened to it: a reminder whose sends all failed,
-- or whose run died part way, could never go out.
--
-- claim_reminder_job is now the only way the job takes a reminder. It starts a
-- new one, or takes back one that failed, partly failed, or was left sending
-- for ten minutes by a run that died; never one that went out, or one another
-- run is sending. A reminder taken back keeps its sent deliveries, so the job
-- sends only to the rest, and its other delivery rows are cleared to be written
-- again. Five attempts, as for notices.

alter table notification_jobs add column claimed_at timestamptz;

comment on column notification_jobs.claimed_at is
  'When the reminders job last took this reminder to send. A reminder still sending ten minutes later was '
  'left by a run that died, and can be taken again. Unused by event and chat jobs.';

create or replace function claim_reminder_job(
  p_team_id uuid,
  p_event_id uuid,
  p_snapshot jsonb,
  p_batch_key text,
  p_retry_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- A new reminder. A retry-only run (the midnight sweep) never starts one.
  if not p_retry_only then
    insert into notification_jobs (team_id, event_id, kind, action, snapshot, status, attempts, batch_key, claimed_at)
    values (p_team_id, p_event_id, 'reminder', 'reminder', p_snapshot, 'sending', 1, p_batch_key, now())
    on conflict (batch_key) do nothing
    returning id into v_id;
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'sent', '[]'::jsonb);
    end if;
  end if;

  -- One already logged: taken back only if it didn't all go out and no run is
  -- sending it. The row lock makes overlapping runs take turns, and the second
  -- finds it sending.
  update notification_jobs j
  set status = 'sending',
      attempts = j.attempts + 1,
      claimed_at = now(),
      last_error = null,
      snapshot = p_snapshot
  where j.batch_key = p_batch_key
    and j.kind = 'reminder'
    and j.attempts < 5
    and (
      j.status in ('failed', 'partial')
      or (j.status = 'sending' and coalesce(j.claimed_at, j.created_at) < now() - interval '10 minutes')
    )
  returning j.id into v_id;
  if v_id is null then
    return null;
  end if;

  delete from notification_deliveries where job_id = v_id and status <> 'sent';

  return jsonb_build_object(
    'id', v_id,
    'sent', coalesce(
      (
        select jsonb_agg(jsonb_build_object('profile_id', d.profile_id, 'channel', d.channel, 'target', d.target))
        from notification_deliveries d
        where d.job_id = v_id and d.status = 'sent'
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke execute on function claim_reminder_job(uuid, uuid, jsonb, text, boolean) from public, authenticated, anon;
