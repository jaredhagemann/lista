-- Tournaments, part 1 review fixes (docs/reviews/2026-10-01-tournaments-and-leagues-review.md,
-- TL-001 to TL-006). A separate migration, because staging already has
-- 20261001000000 from PR #114 and an edit in place wouldn't reach it.
--
--   TL-001  Validation now locks the rows it relies on. A game linking to a
--           tournament takes FOR SHARE on it, which conflicts with an update to
--           the tournament (the foreign key alone takes FOR KEY SHARE, which
--           doesn't). Whichever commits second is checked against the first.
--   TL-002  An event with series occurrences pointing at it can't become a
--           tournament or a tournament game: clearing its own rule left them
--           attached. Occurrences being added lock their head the same way.
--   TL-003  Bulk fill only follows an unanswered game to its tournament. An
--           answered game in the window no longer pulls in a tournament whose
--           other games are outside it.
--   TL-004  delete_tournament notices when it removes any live event, the
--           tournament or one of its games, not only when the tournament is live.
--   TL-005  Every tournament notice lists the games it's about, captured
--           before they change: snapshot.tournament.affected_games.
--   TL-006  create_tournament doesn't notify for a tournament that's already
--           over, as no event notifies once it has ended.

-- ── TL-001, TL-002: links ────────────────────────────────────────────────────

create or replace function events_check_tournament_links()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_tournament events;
  v_joins_tournament boolean;
begin
  if new.tournament_id is not null
     and (tg_op = 'INSERT'
          or new.tournament_id is distinct from old.tournament_id
          or new.team_id is distinct from old.team_id) then
    -- TL-001: FOR SHARE holds the tournament as checked until this commits; an
    -- overlapping update to it waits, then sees this game.
    select * into v_tournament from events where id = new.tournament_id for share;
    if not found or v_tournament.event_type <> 'tournament' then
      raise exception 'NOT_A_TOURNAMENT: a game can only be part of a tournament' using errcode = '23514';
    end if;
    if v_tournament.team_id is distinct from new.team_id then
      raise exception 'TOURNAMENT_TEAM_MISMATCH: a game can only be part of its own team''s tournament'
        using errcode = '23514';
    end if;
  end if;

  -- D18, the other direction: an occurrence of a tournament, or of one of its
  -- games. Locked like the link above, for the same reason.
  if new.parent_event_id is not null
     and (tg_op = 'INSERT' or new.parent_event_id is distinct from old.parent_event_id)
     and exists (
       select 1 from (select * from events p where p.id = new.parent_event_id for share) p
       where p.event_type = 'tournament' or p.tournament_id is not null
     ) then
    raise exception 'TOURNAMENT_NOT_A_SERIES: a tournament and its games are never part of a series'
      using errcode = '23514';
  end if;

  -- TL-002: becoming a tournament, or joining one, while occurrences still
  -- point here as their series head.
  v_joins_tournament :=
    (new.event_type = 'tournament' and (tg_op = 'INSERT' or old.event_type <> 'tournament'))
    or (new.tournament_id is not null and (tg_op = 'INSERT' or old.tournament_id is null));
  if tg_op = 'UPDATE' and v_joins_tournament
     and exists (select 1 from events c where c.parent_event_id = new.id) then
    raise exception 'TOURNAMENT_NOT_A_SERIES: this event still heads a series; a tournament and its games are never part of one'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.event_type = 'tournament' then
    -- Its games would point at something that's no longer a tournament, or be
    -- left on another team. Updating this row already holds it, so a game
    -- linking now waits for this to commit and then sees the change (TL-001).
    if (new.event_type <> 'tournament' or new.team_id is distinct from old.team_id)
       and exists (select 1 from events g where g.tournament_id = old.id) then
      raise exception 'TOURNAMENT_HAS_GAMES: a tournament with games keeps its type and team'
        using errcode = '23514';
    end if;

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

-- ── TL-005: the games a notice is about ──────────────────────────────────────

-- What a notice shows of each game, kept in the job so it survives later edits.
create or replace function tournament_game_summaries(p_ids uuid[])
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'title', g.title,
        'start_time', g.start_time,
        'end_time', g.end_time,
        'timezone', g.timezone,
        'opponent', g.opponent,
        'home_away', g.home_away,
        'round', g.round,
        'is_cancelled', g.is_cancelled
      )
      order by g.start_time, g.id
    ),
    '[]'::jsonb
  )
  from events g
  where g.id = any(p_ids);
$$;

-- The notice now carries the affected games' summaries, taken by the caller
-- before it changes them.
drop function enqueue_tournament_notice(events, text, integer, integer, text);

create or replace function enqueue_tournament_notice(
  p_tournament events,
  p_action text,
  p_games integer,
  p_games_action text,
  p_affected_games jsonb
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

  -- snapshot.tournament: games (how many it has or had), affected (how many
  -- this action changed), games_action ('created' | 'cancelled' | 'kept' |
  -- 'deleted'), and affected_games, each as tournament_game_summaries shows it.
  perform enqueue_notification_job(
    p_tournament.team_id,
    p_tournament.id,
    p_action,
    event_notification_snapshot(p_tournament)
      || jsonb_build_object(
        'tournament',
        jsonb_build_object(
          'games', p_games,
          'affected', jsonb_array_length(coalesce(p_affected_games, '[]'::jsonb)),
          'games_action', p_games_action,
          'affected_games', coalesce(p_affected_games, '[]'::jsonb)
        )
      )
  );
end;
$$;

revoke execute on function enqueue_tournament_notice(events, text, integer, text, jsonb) from public, anon;
grant execute on function enqueue_tournament_notice(events, text, integer, text, jsonb) to authenticated;

-- ── create_tournament: TL-005, TL-006 ────────────────────────────────────────

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
  v_game_ids uuid[];
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

  with inserted as (
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
    from jsonb_array_elements(coalesce(p_games, '[]'::jsonb)) g
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_game_ids from inserted;

  select * into v_tournament from events where id = v_id;
  -- TL-006: entering a tournament that's already over tells nobody.
  if p_notify and v_tournament.end_time >= now() then
    perform enqueue_tournament_notice(
      v_tournament, 'created', cardinality(v_game_ids), 'created', tournament_game_summaries(v_game_ids)
    );
  end if;

  perform set_config('lista.tournament_action', 'off', true);
  return v_id;
end;
$$;

-- ── delete_tournament: TL-004, TL-005 ────────────────────────────────────────

create or replace function delete_tournament(p_tournament_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_tournament events;
  v_game_ids uuid[];
  v_live_game_ids uuid[];
  v_summaries jsonb;
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

  -- Before deleting: every game, and the live ones, each judged as a single
  -- event's deletion would be (not cancelled, not over).
  select
    coalesce(array_agg(id), '{}'),
    coalesce(array_agg(id) filter (where not coalesce(is_cancelled, false) and end_time >= now()), '{}')
  into v_game_ids, v_live_game_ids
  from events where tournament_id = p_tournament_id;
  v_summaries := tournament_game_summaries(v_game_ids);

  delete from events where tournament_id = p_tournament_id;
  get diagnostics v_games = row_count;
  delete from events where id = p_tournament_id;

  -- TL-004: one notice when anything live goes, the tournament or a game.
  if (not coalesce(v_tournament.is_cancelled, false) and v_tournament.end_time >= now())
     or cardinality(v_live_game_ids) > 0 then
    perform enqueue_tournament_notice(v_tournament, 'deleted', v_games, 'deleted', v_summaries);
  end if;

  perform set_config('lista.tournament_action', 'off', true);
  return v_games + 1;
end;
$$;

-- ── cancel_tournament: TL-005 ────────────────────────────────────────────────

create or replace function cancel_tournament(p_tournament_id uuid, p_cancel_games boolean)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_tournament events;
  v_games integer;
  v_affected_ids uuid[];
  v_summaries jsonb;
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

  -- The upcoming games this changes, summarized before they're cancelled or
  -- unlinked: unlinked games can't be found from the tournament afterwards.
  select coalesce(array_agg(id), '{}') into v_affected_ids
  from events
  where tournament_id = p_tournament_id
    and start_time > now()
    and (not p_cancel_games or not coalesce(is_cancelled, false));
  v_summaries := tournament_game_summaries(v_affected_ids);

  if p_cancel_games then
    update events set is_cancelled = true where id = any(v_affected_ids);
  else
    update events set tournament_id = null, round = null where id = any(v_affected_ids);
  end if;

  update events set is_cancelled = true where id = p_tournament_id;
  select * into v_tournament from events where id = p_tournament_id;

  if v_tournament.end_time >= now() then
    perform enqueue_tournament_notice(
      v_tournament, 'cancelled', v_games, case when p_cancel_games then 'cancelled' else 'kept' end, v_summaries
    );
  end if;

  perform set_config('lista.tournament_action', 'off', true);
  return cardinality(v_affected_ids);
end;
$$;

-- ── TL-003: bulk answers ─────────────────────────────────────────────────────

-- As in 20261001000000, but a game only stands for its tournament while the
-- game itself is unanswered: then answering the tournament is what answers it.
-- An answered game has nothing to fill, and mustn't pull in a tournament whose
-- other games lie outside the chosen window.
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
    -- TL-003: the event in the window is unanswered itself…
    and not exists (
      select 1 from availability a
      where a.event_id = e.id
        and a.profile_id = p_profile_id
    )
    -- …and so is what gets the answer.
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
