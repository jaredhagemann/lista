-- Leagues, part 2 (docs/specs/tournaments-and-leagues.md §5, §4 "Web").
--
--   D21, clarified 2026-10-09 (review of #124): one league per name and season
--   on a team ignores case, edge spaces, and runs of spaces inside, so
--   "Division  3" is "Division 3". The index normalizes both keys alike.
--
--   create_tournament: each game may carry a league_id, given with it, as the
--   tournament form offers (D4). Unchanged otherwise from 20261001000001.
--   events_check_league holds it to the team's own leagues, so another team's
--   aborts the whole call.

-- ── D21 ──────────────────────────────────────────────────────────────────────

drop index leagues_team_name_season_key;
create unique index leagues_team_name_season_key on leagues (
  team_id,
  regexp_replace(lower(btrim(name)), '\s+', ' ', 'g'),
  regexp_replace(lower(btrim(season)), '\s+', ' ', 'g')
);

-- ── create_tournament: a league per game ─────────────────────────────────────

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
      opponent, home_away, uniform, round, location_id, league_id, arrival_time, notes, created_by
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
      -- A game's league, given with it (D4). events_check_league holds it to the team's own.
      nullif(g->>'league_id', '')::uuid,
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
