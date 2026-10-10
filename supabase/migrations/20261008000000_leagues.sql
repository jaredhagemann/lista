-- Leagues (docs/specs/tournaments-and-leagues.md §5; D4, D9, D10, D17, D20, D21).
--
-- A league is a team's, for one season: "Division 3", "Fall 2026". Games carry
-- it in events.league_id, which is classification only: tagging a game, played
-- or upcoming, notifies nobody (the change trigger ignores the column). Records
-- per league are computed by the apps from those tags.
--
--   D17  archived_at hides a league from pickers and the Record card; its games
--        keep their tags, so its record stays.
--   D20  a league with games can't be deleted: archive it instead.
--   D21  one league per name and season on a team, ignoring case and spaces.
--
-- 1.0.12 reads neither the table nor the column.

-- ── The table ────────────────────────────────────────────────────────────────

create table leagues (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  season      text not null check (btrim(season) <> ''),
  archived_at timestamptz,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- D21
create unique index leagues_team_name_season_key
  on leagues (team_id, lower(btrim(name)), lower(btrim(season)));

alter table leagues enable row level security;

create policy "Team members can view leagues"
  on leagues for select
  using (is_team_member(team_id));

create policy "Team admins can insert leagues"
  on leagues for insert
  with check (is_team_admin(team_id));

create policy "Team admins can update leagues"
  on leagues for update
  using (is_team_admin(team_id))
  with check (is_team_admin(team_id));

create policy "Team admins can delete leagues"
  on leagues for delete
  using (is_team_admin(team_id));

-- A closed club's leagues are read-only, as its other tables are (20260924000001).
create trigger leagues_refuse_closed_club_write
  before insert or update or delete on leagues
  for each row execute function refuse_closed_club_write('team');

-- A league stays on its team: its games' tags were checked against it.
create or replace function leagues_keep_team()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.team_id is distinct from old.team_id then
    raise exception 'LEAGUE_TEAM_FIXED: a league stays on its team' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger leagues_keep_team
  before update of team_id on leagues
  for each row execute function leagues_keep_team();

-- D20: refused with a reason, rather than the foreign key's generic violation.
-- Not when the delete is a cascade (pg_trigger_depth() > 1): deleting the team
-- takes its games with it in the same statement.
create or replace function leagues_refuse_delete_with_games()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if pg_trigger_depth() = 1 and exists (select 1 from events e where e.league_id = old.id) then
    raise exception 'LEAGUE_HAS_GAMES: this league has games; archive it instead, which keeps its record'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

create trigger leagues_refuse_delete_with_games
  before delete on leagues
  for each row execute function leagues_refuse_delete_with_games();

-- ── Games ────────────────────────────────────────────────────────────────────

-- No action, not restrict: checked at the end of the statement, so a team's
-- deletion, which removes its games and its leagues together, goes through.
alter table events add column league_id uuid references leagues(id);

alter table events add constraint events_league_games_only
  check (league_id is null or event_type = 'game');

create index events_league_idx on events (league_id) where league_id is not null;

-- A game's league is its own team's. Checked when either changes.
create or replace function events_check_league()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.league_id is not null
     and (tg_op = 'INSERT'
          or new.league_id is distinct from old.league_id
          or new.team_id is distinct from old.team_id)
     and not exists (select 1 from leagues l where l.id = new.league_id and l.team_id = new.team_id) then
    raise exception 'LEAGUE_TEAM_MISMATCH: a game can only be in its own team''s league' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger events_check_league
  before insert or update of league_id, team_id on events
  for each row execute function events_check_league();
