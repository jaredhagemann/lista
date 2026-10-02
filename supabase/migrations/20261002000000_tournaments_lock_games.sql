-- Tournaments: act only on games still in the tournament (review TL-007,
-- docs/reviews/2026-10-01-tournaments-and-leagues-review.md).
--
-- cancel_tournament (20261001000001) chose its games, summarized them, then
-- updated them by id alone. A game moved to another tournament in between was
-- cancelled, or unlinked from its new tournament, by an action on its old one.
-- delete_tournament had the same gap in its notice: it summarized games, and
-- decided whether any were live, before the delete re-checked membership, so a
-- game moved away could be listed, or send a notice, without being deleted.
--
-- Both now lock the tournament, then lock its games with FOR UPDATE before
-- reading anything about them. Under read committed, a row that changed while
-- the lock waited is re-checked against the filter, so a game moved away drops
-- out. What's summarized, counted and changed is exactly the set locked.

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
  -- Then locked and read again: a concurrent cancel or delete of it waits. Only
  -- after the admin check, because FOR UPDATE sees only rows the caller may
  -- update, which would turn "not authorized" into "not found".
  select * into v_tournament from events where id = p_tournament_id for update;
  if not found then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if coalesce(v_tournament.is_cancelled, false) then
    raise exception 'ALREADY_CANCELLED' using errcode = '22023';
  end if;
  if p_cancel_games is null then
    raise exception 'CHOOSE_WHAT_HAPPENS_TO_GAMES' using errcode = '22023';
  end if;

  perform set_config('lista.tournament_action', 'on', true);

  -- TL-007: the upcoming games still in it, locked, so the summary, the count
  -- and the change all cover the same rows.
  select coalesce(array_agg(id), '{}') into v_affected_ids
  from (
    select id from events
    where tournament_id = p_tournament_id
      and start_time > now()
      and (not p_cancel_games or not coalesce(is_cancelled, false))
    order by id
    for update
  ) locked;
  v_summaries := tournament_game_summaries(v_affected_ids);

  select count(*) into v_games from events where tournament_id = p_tournament_id;

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
  -- Locked and read again after the admin check, as in cancel_tournament.
  select * into v_tournament from events where id = p_tournament_id for update;
  if not found then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform set_config('lista.tournament_action', 'on', true);

  -- TL-007: its games, locked, then judged and summarized: the rows deleted
  -- below are exactly these.
  select coalesce(array_agg(id), '{}') into v_game_ids
  from (
    select id from events where tournament_id = p_tournament_id order by id for update
  ) locked;

  select coalesce(array_agg(id), '{}') into v_live_game_ids
  from events
  where id = any(v_game_ids) and not coalesce(is_cancelled, false) and end_time >= now();
  v_summaries := tournament_game_summaries(v_game_ids);

  delete from events where id = any(v_game_ids);
  get diagnostics v_games = row_count;
  delete from events where id = p_tournament_id;

  if (not coalesce(v_tournament.is_cancelled, false) and v_tournament.end_time >= now())
     or cardinality(v_live_game_ids) > 0 then
    perform enqueue_tournament_notice(v_tournament, 'deleted', v_games, 'deleted', v_summaries);
  end if;

  perform set_config('lista.tournament_action', 'off', true);
  return v_games + 1;
end;
$$;
