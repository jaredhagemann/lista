-- Scale fixture for the pagination work (BUG-014, spec §13).
--
-- Builds one team with a long history and a crowded roster, so the reads can be
-- measured against data that dwarfs what any page shows:
--
--   * 100,000 events, almost all of them in the past
--   * 320 events inside the upcoming availability window
--   * a roster of 150 members, so ten displayed events carry 1,500 responses
--   * responses seeded as real rows, not merely possible event/player pairs
--
-- Takes a caller uuid (:caller) — a real signed-in profile — and puts it on the
-- team, so every measurement runs under that user's own policies rather than
-- the service role's absence of them.
--
-- Never run against a database holding real player data (spec §13).

\set ON_ERROR_STOP on

begin;

-- Idempotent: a re-run replaces the fixture rather than stacking another one.
-- The organization cascades to its team, events, memberships and responses; the
-- roster profiles are not owned by it, so they go separately.
delete from organizations where slug = 'scale-check-fixture';
delete from profiles where email like 'scale-player-%@fixture.local';

insert into organizations (id, name, slug, plan)
values ('5ca1e000-0000-0000-0000-000000000001', 'Scale Check FC', 'scale-check-fixture', 'club_large');

insert into teams (id, organization_id, name, timezone)
values (
  '5ca1e000-0000-0000-0000-000000000002',
  '5ca1e000-0000-0000-0000-000000000001',
  'Scale Check U12',
  'America/Los_Angeles'
);

-- The roster: 150 managed profiles, each a player on the team.
insert into profiles (id, first_name, last_name, email)
select
  ('5ca1e001-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'Player',
  'Number' || n,
  'scale-player-' || n || '@fixture.local'
from generate_series(1, 150) as n;

insert into team_members (team_id, profile_id, role)
select
  '5ca1e000-0000-0000-0000-000000000002',
  ('5ca1e001-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'player'
from generate_series(1, 150) as n;

-- The caller, on the same team, reading as themselves.
insert into team_members (team_id, profile_id, role)
values ('5ca1e000-0000-0000-0000-000000000002', :'caller', 'player')
on conflict do nothing;

-- 100,000 events. The first 99,680 are history, stretching back about 27 years
-- at four a day; the last 320 land inside the upcoming window, which is what
-- the availability matrix pages through.
insert into events (id, team_id, title, event_type, start_time, end_time, is_cancelled, created_by)
select
  ('5ca1e002-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '5ca1e000-0000-0000-0000-000000000002',
  'Event ' || n,
  (array['practice', 'game', 'other'])[1 + (n % 3)],
  start_at,
  start_at + interval '90 minutes',
  -- A realistic sprinkling of cancellations, including some with no flag at
  -- all, the way rows predating the column look.
  case when n % 97 = 0 then true when n % 89 = 0 then null else false end,
  :'caller'
from generate_series(1, 100000) as n
cross join lateral (
  select case
    when n <= 99680
      then now() - ((99680 - n) * interval '6 hours')
    else now() + ((n - 99680) * interval '12 hours')
  end as start_at
) as t;

-- Responses for the first three pages of the upcoming window (30 events), from
-- every member of the roster: 4,500 rows, so a displayed page of ten events
-- carries 1,500 — past the API's row cap on its own.
insert into availability (event_id, profile_id, status)
select
  e.id,
  ('5ca1e001-0000-0000-0000-' || lpad(p::text, 12, '0'))::uuid,
  (array['available', 'maybe', 'unavailable'])[1 + ((p + e.seq) % 3)]
from (
  select id, row_number() over (order by start_time, id) as seq
  from events
  where team_id = '5ca1e000-0000-0000-0000-000000000002'
    and start_time >= now()
  order by start_time, id
  limit 30
) as e
cross join generate_series(1, 150) as p
on conflict (event_id, profile_id) do nothing;

commit;

analyze events;
analyze availability;
analyze team_members;

select
  (select count(*) from events where team_id = '5ca1e000-0000-0000-0000-000000000002') as events,
  (select count(*) from events
     where team_id = '5ca1e000-0000-0000-0000-000000000002' and start_time >= now()) as upcoming,
  (select count(*) from team_members
     where team_id = '5ca1e000-0000-0000-0000-000000000002') as roster,
  (select count(*) from availability a
     join events e on e.id = a.event_id
    where e.team_id = '5ca1e000-0000-0000-0000-000000000002') as responses;
