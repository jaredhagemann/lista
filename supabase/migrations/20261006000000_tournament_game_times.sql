-- Tournaments: a game ends after it starts (review TL-012,
-- docs/reviews/2026-10-01-tournaments-and-leagues-review.md).
--
-- create_tournament and a plain insert both accepted a game ending at or before
-- its start. Overlap queries then treat it as over before kickoff, and its
-- notices show impossible times. The forms check too; this holds for every
-- writer.
--
-- Scoped to tournament games. A check constraint on every event would also
-- apply to any existing standalone event with such times, making it fail on its
-- next update (a cancel, a score), and those predate tournaments.

create or replace function events_check_tournament_game_times()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tournament_id is not null and new.end_time <= new.start_time then
    raise exception 'INVALID_GAME_TIMES: a game has to end after it starts' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists events_check_tournament_game_times on events;
create trigger events_check_tournament_game_times
  before insert or update of start_time, end_time, tournament_id on events
  for each row execute function events_check_tournament_game_times();
