-- Tournaments (docs/specs/tournaments-and-leagues.md §4; decisions D1–D18, 2026-10-01).
--
-- A tournament is an event (event_type 'tournament') spanning whole days in its
-- zone (D13). Its games are ordinary game events pointing at it through
-- events.tournament_id. So:
--
--   1. The event type, and the new columns: placement (the tournament's), and
--      tournament_id and round (a game's). Row checks keep each column to its
--      own kind of event, and keep tournaments and their games out of recurring
--      series (D18).
--   2. A trigger checks what a row checks can't: a game's tournament is a
--      tournament on the same team; nothing is an occurrence of a tournament or
--      its game; a tournament with games keeps its type; and a tournament with
--      upcoming games isn't cancelled on its own (D15). Each of those would
--      leave games in a state the spec doesn't define.
--   3. Indexes for overlap queries (spec §4, "Multi-day events in queries") and
--      for a tournament's games.
--   4. Notifications: a tournament-wide action sends one tournament notice, so
--      its own rows enqueue nothing (a transaction-local flag, as for a series
--      edit in 20260929000000). A game's snapshot names its tournament and round.
--   5. create_tournament, delete_tournament and cancel_tournament. Restoring is
--      a plain update: it changes one row, and the trigger's notice is the
--      tournament's own.
--   6. set_unanswered_availability answers tournaments, never their games
--      (D16, D16b).
--
-- The installed 1.0.12 app never writes events, so none of the new refusals
-- reach it (spec §7).

-- ── 1. Columns and row checks ────────────────────────────────────────────────

alter table events drop constraint events_event_type_check;
alter table events add constraint events_event_type_check
  check (event_type in ('practice', 'game', 'other', 'tournament'));

alter table events
  add column tournament_id uuid references events(id),
  add column round text check (round is null or char_length(round) between 1 and 60),
  add column placement_rank integer check (placement_rank is null or placement_rank between 1 and 999),
  add column placement_label text check (placement_label is null or char_length(placement_label) between 1 and 80);

-- Placement belongs to a tournament.
alter table events add constraint events_placement_only_on_tournaments
  check (event_type = 'tournament' or (placement_rank is null and placement_label is null));

-- A tournament and a round belong to a game.
alter table events add constraint events_tournament_only_on_games
  check (event_type = 'game' or (tournament_id is null and round is null));

alter table events add constraint events_tournament_not_self
  check (tournament_id is distinct from id);

-- D18: a tournament, and every game in one, stands alone: never a series head
-- (recurrence_rule) nor an occurrence (parent_event_id). Deleting or cancelling
-- a tournament's games can then never reach a series.
alter table events add constraint events_tournament_standalone
  check (
    (event_type <> 'tournament' and tournament_id is null)
    or (recurrence_rule is null and parent_event_id is null)
  );

-- ── 2. Links between rows ────────────────────────────────────────────────────

create or replace function events_check_tournament_links()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_tournament events;
begin
  if new.tournament_id is not null
     and (tg_op = 'INSERT'
          or new.tournament_id is distinct from old.tournament_id
          or new.team_id is distinct from old.team_id) then
    select * into v_tournament from events where id = new.tournament_id;
    if not found or v_tournament.event_type <> 'tournament' then
      raise exception 'NOT_A_TOURNAMENT: a game can only be part of a tournament' using errcode = '23514';
    end if;
    if v_tournament.team_id is distinct from new.team_id then
      raise exception 'TOURNAMENT_TEAM_MISMATCH: a game can only be part of its own team''s tournament'
        using errcode = '23514';
    end if;
  end if;

  -- D18, the other direction: an occurrence of a tournament, or of one of its games.
  if new.parent_event_id is not null
     and (tg_op = 'INSERT' or new.parent_event_id is distinct from old.parent_event_id)
     and exists (
       select 1 from events p
       where p.id = new.parent_event_id
         and (p.event_type = 'tournament' or p.tournament_id is not null)
     ) then
    raise exception 'TOURNAMENT_NOT_A_SERIES: a tournament and its games are never part of a series'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.event_type = 'tournament' then
    -- Its games would point at something that's no longer a tournament, or be
    -- left on another team.
    if (new.event_type <> 'tournament' or new.team_id is distinct from old.team_id)
       and exists (select 1 from events g where g.tournament_id = old.id) then
      raise exception 'TOURNAMENT_HAS_GAMES: a tournament with games keeps its type and team'
        using errcode = '23514';
    end if;

    -- D15: cancelling a tournament decides what happens to its upcoming games,
    -- which only cancel_tournament asks. A plain cancel would leave them on the
    -- schedule, still linked to a cancelled tournament.
    if new.is_cancelled and not coalesce(old.is_cancelled, false)
       and coalesce(current_setting('lista.tournament_action', true), 'off') <> 'on'
       and exists (
         select 1 from events g
         where g.tournament_id = old.id and g.start_time > now() and not coalesce(g.is_cancelled, false)
       ) then
      raise exception 'TOURNAMENT_HAS_GAMES: cancel a tournament with upcoming games through cancel_tournament'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger events_check_tournament_links
  before insert or update on events
  for each row execute function events_check_tournament_links();

-- ── 3. Indexes ───────────────────────────────────────────────────────────────

-- Overlap with a window is start_time < end and end_time > start; Upcoming is
-- end_time > now. (team_id, start_time, id) already exists (20260921000000).
create index events_team_end_idx on events (team_id, end_time);
create index events_tournament_idx on events (tournament_id) where tournament_id is not null;

-- ── 4. Notifications ─────────────────────────────────────────────────────────

-- As in 20260928000000, plus a game's round and tournament, so its own notice
-- can say "Part of Surf Cup · Semifinal".
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
    'notes', e.notes,
    'round', e.round,
    'tournament_id', e.tournament_id,
    'tournament_title', (select t.title from events t where t.id = e.tournament_id)
  );
$$;

-- As in 20260929000000, and quiet inside a tournament action too, which sends
-- its own notice.
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
  if coalesce(current_setting('lista.series_edit', true), 'off') = 'on'
     or coalesce(current_setting('lista.tournament_action', true), 'off') = 'on' then
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
    -- Title, notes, opponent, results, placement, league: optional under D3,
    -- so the app asks.
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

-- The one notice a tournament action sends. enqueue_notification_job isn't
-- callable by signed-in users, so this is, but only inside a tournament action
-- (the flag) and only for an admin of the tournament's team. The tournament row
-- is passed in, because a deleted tournament can't be read back.
--
-- snapshot.tournament: { games: how many it has (or had), affected: how many
-- this action changed, games_action: 'created' | 'cancelled' | 'kept' |
-- 'deleted' }. The worker renders it as a tournament, never as a series.
create or replace function enqueue_tournament_notice(
  p_tournament events,
  p_action text,
  p_games integer,
  p_affected integer,
  p_games_action text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('lista.tournament_action', true), 'off') <> 'on' then
    raise exception 'NOT_IN_TOURNAMENT_ACTION' using errcode = '42501';
  end if;
  if p_tournament.event_type <> 'tournament' or not is_team_admin(p_tournament.team_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_action not in ('created', 'cancelled', 'deleted') then
    raise exception 'UNSUPPORTED_ACTION: %', p_action using errcode = '22023';
  end if;

  perform enqueue_notification_job(
    p_tournament.team_id,
    p_tournament.id,
    p_action,
    event_notification_snapshot(p_tournament)
      || jsonb_build_object(
        'tournament',
        jsonb_build_object('games', p_games, 'affected', p_affected, 'games_action', p_games_action)
      )
  );
end;
$$;

revoke execute on function enqueue_tournament_notice(events, text, integer, integer, text) from public, anon;
grant execute on function enqueue_tournament_notice(events, text, integer, integer, text) to authenticated;

-- ── 5. Tournament actions ────────────────────────────────────────────────────
--
-- Each runs with the caller's privileges, so the events policies and the
-- closed-club triggers still apply, and checks team admin first for a clear
-- error, as delete_event_series does.

-- Saves a tournament over p_first_day..p_last_day (inclusive, whole days in its
-- zone) and its games, in one transaction. p_games is an array of objects:
-- start_time, end_time (required), and title, opponent, home_away, uniform,
-- round, location_id, arrival_time, notes. With p_notify, one 'created' notice.
create or replace function create_tournament(
  p_team_id uuid,
  p_title text,
  p_first_day date,
  p_last_day date,
  p_timezone text default null,
  p_location_id uuid default null,
  p_notes text default null,
  p_games jsonb default '[]'::jsonb,
  p_notify boolean default true
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_zone text;
  v_id uuid := gen_random_uuid();
  v_tournament events;
  v_games integer;
begin
  if not is_team_admin(p_team_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_first_day is null or p_last_day is null or p_last_day < p_first_day then
    raise exception 'INVALID_TOURNAMENT_DAYS: the last day is before the first' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_games, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_GAMES: p_games must be an array' using errcode = '22023';
  end if;

  v_zone := coalesce(nullif(p_timezone, ''), (select timezone from teams where id = p_team_id), 'UTC');

  perform set_config('lista.tournament_action', 'on', true);

  -- Midnight starting the first day, to midnight ending the last, in its zone.
  -- events_set_timezone validates the zone.
  insert into events (id, team_id, title, event_type, start_time, end_time, timezone, location_id, notes, created_by)
  values (
    v_id,
    p_team_id,
    p_title,
    'tournament',
    (p_first_day::timestamp) at time zone v_zone,
    ((p_last_day + 1)::timestamp) at time zone v_zone,
    v_zone,
    p_location_id,
    p_notes,
    auth.uid()
  );

  insert into events (
    id, team_id, tournament_id, title, event_type, start_time, end_time, timezone,
    opponent, home_away, uniform, round, location_id, arrival_time, notes, created_by
  )
  select
    gen_random_uuid(),
    p_team_id,
    v_id,
    coalesce(nullif(g->>'title', ''), 'Game'),
    'game',
    (g->>'start_time')::timestamptz,
    (g->>'end_time')::timestamptz,
    v_zone,
    nullif(g->>'opponent', ''),
    nullif(g->>'home_away', ''),
    nullif(g->>'uniform', ''),
    nullif(g->>'round', ''),
    nullif(g->>'location_id', '')::uuid,
    nullif(g->>'arrival_time', '')::integer,
    nullif(g->>'notes', ''),
    auth.uid()
  from jsonb_array_elements(coalesce(p_games, '[]'::jsonb)) g;
  get diagnostics v_games = row_count;

  if p_notify then
    select * into v_tournament from events where id = v_id;
    perform enqueue_tournament_notice(v_tournament, 'created', v_games, v_games, 'created');
  end if;

  perform set_config('lista.tournament_action', 'off', true);
  return v_id;
end;
$$;

-- D5: deletes a tournament, its games and (by cascade) their answers, with one
-- notice. Returns how many events it deleted, the tournament included.
create or replace function delete_tournament(p_tournament_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_tournament events;
  v_games integer;
begin
  select * into v_tournament from events where id = p_tournament_id and event_type = 'tournament';
  if not found then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not is_team_admin(v_tournament.team_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform set_config('lista.tournament_action', 'on', true);

  delete from events where tournament_id = p_tournament_id;
  get diagnostics v_games = row_count;
  delete from events where id = p_tournament_id;

  -- As for any deleted event: no notice for one already cancelled, or over.
  if not coalesce(v_tournament.is_cancelled, false) and v_tournament.end_time >= now() then
    perform enqueue_tournament_notice(v_tournament, 'deleted', v_games, v_games, 'deleted');
  end if;

  perform set_config('lista.tournament_action', 'off', true);
  return v_games + 1;
end;
$$;

-- D15: cancels a tournament. With p_cancel_games, its upcoming games are
-- cancelled too; without, they're unlinked and stay on the schedule as
-- standalone games. Played games keep their place either way. One notice.
-- Returns how many games it changed.
create or replace function cancel_tournament(p_tournament_id uuid, p_cancel_games boolean)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_tournament events;
  v_games integer;
  v_affected integer;
begin
  select * into v_tournament from events where id = p_tournament_id and event_type = 'tournament';
  if not found then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not is_team_admin(v_tournament.team_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if coalesce(v_tournament.is_cancelled, false) then
    raise exception 'ALREADY_CANCELLED' using errcode = '22023';
  end if;
  if p_cancel_games is null then
    raise exception 'CHOOSE_WHAT_HAPPENS_TO_GAMES' using errcode = '22023';
  end if;

  perform set_config('lista.tournament_action', 'on', true);

  select count(*) into v_games from events where tournament_id = p_tournament_id;

  if p_cancel_games then
    update events set is_cancelled = true
    where tournament_id = p_tournament_id and start_time > now() and not coalesce(is_cancelled, false);
  else
    update events set tournament_id = null, round = null
    where tournament_id = p_tournament_id and start_time > now();
  end if;
  get diagnostics v_affected = row_count;

  update events set is_cancelled = true where id = p_tournament_id;
  select * into v_tournament from events where id = p_tournament_id;

  if v_tournament.end_time >= now() then
    perform enqueue_tournament_notice(
      v_tournament, 'cancelled', v_games, v_affected,
      case when p_cancel_games then 'cancelled' else 'kept' end
    );
  end if;

  perform set_config('lista.tournament_action', 'off', true);
  return v_affected;
end;
$$;

revoke execute on function create_tournament(uuid, text, date, date, text, uuid, text, jsonb, boolean) from public, anon;
grant execute on function create_tournament(uuid, text, date, date, text, uuid, text, jsonb, boolean) to authenticated;
revoke execute on function delete_tournament(uuid) from public, anon;
grant execute on function delete_tournament(uuid) to authenticated;
revoke execute on function cancel_tournament(uuid, boolean) from public, anon;
grant execute on function cancel_tournament(uuid, boolean) to authenticated;

-- ── 6. Bulk answers ──────────────────────────────────────────────────────────

-- As in 20260922000000, with tournaments (D16, D16b): a tournament's games are
-- never answered here, because an answer on a game is an override that stops
-- following the tournament. A game in the window stands for its tournament
-- instead, so an underway tournament is still reached. The 'game' filter covers
-- standalone games only; 'tournament' covers tournaments.
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

  if p_event_type is not null and p_event_type not in ('practice', 'game', 'other', 'tournament') then
    raise exception 'Unsupported event type: %', p_event_type using errcode = '22023';
  end if;

  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'Window start must be before window end' using errcode = '22023';
  end if;

  if p_to - p_from > interval '800 days' then
    raise exception 'Window is wider than any selectable range' using errcode = '22023';
  end if;

  if p_profile_id <> auth.uid() and not is_managed_by_me(p_profile_id) then
    raise exception 'Not permitted to answer for this profile' using errcode = '42501';
  end if;

  if not exists (
    select 1 from team_members
    where team_id = p_team_id and profile_id = p_profile_id
  ) then
    raise exception 'Profile is not a member of this team' using errcode = '42501';
  end if;

  insert into availability (event_id, profile_id, status)
  select distinct target.id, p_profile_id, p_status
  from events e
  -- A tournament's game stands for its tournament.
  join events target on target.id = coalesce(e.tournament_id, e.id)
  where e.team_id = p_team_id
    and e.start_time >= greatest(p_from, now())
    and e.start_time < p_to
    and coalesce(e.is_cancelled, false) = false
    and coalesce(target.is_cancelled, false) = false
    and (
      p_event_type is null
      or (p_event_type = 'game' and e.event_type = 'game' and e.tournament_id is null)
      or (p_event_type = 'tournament' and (e.event_type = 'tournament' or e.tournament_id is not null))
      or (p_event_type in ('practice', 'other') and e.event_type = p_event_type)
    )
    and not exists (
      select 1 from availability a
      where a.event_id = target.id
        and a.profile_id = p_profile_id
    )
  on conflict (event_id, profile_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
