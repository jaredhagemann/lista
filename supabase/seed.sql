-- Local development seed data.
--
-- Runs automatically after migrations on `supabase db reset` (config.toml ->
-- [db.seed] sql_paths = ["./seed.sql"]). This file is LOCAL-ONLY dev/test
-- scaffolding — it is never applied to staging or production (those go through
-- the migrate.yml PR flow), so hard-coded credentials here are safe.
--
-- Provides ready-to-use, signed-in-able accounts + demo data for exercising
-- club-tier features (Training, schedule, availability) in the UI without
-- clicking through signup + team creation + trial start every reset:
--
--   coach@lista.test  / password123
--     Coach on "Dev FC" (team admin) + owner of "Lista Dev Club" org.
--     Use for coach-only surfaces (Manage categories, Team training tab, …).
--   player@lista.test / password123  ("Sam Bench")
--     Player on Dev FC, ranked #16 of 20 on the leaderboard (below the fold) —
--     use to see the current-user row pinned into view.
--   Org plan: club_small, subscription active (grants club access).
--
-- Demo data (see the "Demo data" section at the bottom): 20 roster players each
-- with a training session, a handful of schedule events, and availability RSVPs
-- for every team member. All dates are computed relative to now() so training
-- sessions always fall inside the current 7-day window and the schedule always
-- shows upcoming events, no matter when the reset runs.
--
-- The profile row, the self 'Self' profile_managers link, and the team's
-- default "General" training category are all created automatically by existing
-- triggers (handle_new_user on auth.users insert; seed_team_default_category_trg
-- on teams insert) — we only insert the auth user, org, team, and memberships.

-- Fixed IDs so the seed is deterministic and re-runnable.
--   user 11111111…  org 22222222…  team 33333333…

-- 1. Auth user (fires handle_new_user -> profiles + profile_managers). The
--    first_name/last_name come from raw_user_meta_data. Password is bcrypt via
--    pgcrypto (installed in the `extensions` schema on Supabase).
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated',
  'authenticated',
  'coach@lista.test',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"first_name":"Dev","last_name":"Coach"}',
  now(),
  now(),
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

-- 2. Email identity for the user (required for password sign-in).
insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"coach@lista.test","email_verified":true}',
  'email',
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do nothing;

-- 3. Club-tier organization (club_small + active subscription = club access).
insert into organizations (id, name, slug, plan, subscription_status, created_by)
values (
  '22222222-2222-2222-2222-222222222222',
  'Lista Dev Club',
  'lista-dev-club',
  'club_small',
  'active',
  '11111111-1111-1111-1111-111111111111'
)
on conflict (id) do nothing;

-- 4. Team (fires seed_team_default_category_trg -> "General" category). owner_id
--    must reference an auth-backed profile (enforce_owner_id_trigger).
insert into teams (id, organization_id, name, sport, timezone, owner_id)
values (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  'Dev FC',
  'soccer',
  'America/New_York',
  '11111111-1111-1111-1111-111111111111'
)
on conflict (id) do nothing;

-- 5. Team membership as coach (team admin -> can manage training categories).
insert into team_members (team_id, profile_id, role)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'coach'
)
on conflict do nothing;

-- 6. Organization membership as owner (so the org/Plan surfaces work too).
insert into organization_members (organization_id, profile_id, role)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'owner'
)
on conflict (organization_id, profile_id) do nothing;

-- 7. Point the profile's active team at Dev FC so the app resolves it on login.
update profiles
set active_team_id = '33333333-3333-3333-3333-333333333333'
where id = '11111111-1111-1111-1111-111111111111';


-- ============================================================
-- Demo data (durable): roster of 20 players, training sessions, schedule
-- events, and availability. Idempotent (deterministic ids / ON CONFLICT) so a
-- manual re-run is a no-op. All dates are relative to now() — see header.
-- ============================================================

-- Loggable player account "Sam Bench" (fires handle_new_user -> profile).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '44444444-4444-4444-4444-444444444444',
  'authenticated', 'authenticated', 'player@lista.test',
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"first_name":"Sam","last_name":"Bench"}', now(), now(), '', '', '', ''
) on conflict (id) do nothing;

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '44444444-4444-4444-4444-444444444444',
  '44444444-4444-4444-4444-444444444444',
  '{"sub":"44444444-4444-4444-4444-444444444444","email":"player@lista.test","email_verified":true}',
  'email', now(), now(), now()
) on conflict (provider_id, provider) do nothing;

-- Roster: login player (mid-low) + 19 managed (no-auth) players. Distinct
-- minutes give stable leaderboard ranks; the login player sits at #16. Per
-- session: 5–300 min; per player-day: <=360 (one session each keeps both safe).
--
-- The roster is inlined as a WITH-CTE in each statement below rather than a temp
-- table: the Supabase CLI seeds the file in separate batches/connections, so a
-- session-scoped temp table would not survive between statements.

-- Managed profiles (the login player's profile already exists via the trigger).
with roster(id, first, last, minutes) as (values
  ('44444444-4444-4444-4444-444444444444'::uuid,'Sam','Bench',120),
  ('a0000000-0000-0000-0000-000000000001'::uuid,'Ava','Nguyen',300),
  ('a0000000-0000-0000-0000-000000000002'::uuid,'Liam','Ortiz',290),
  ('a0000000-0000-0000-0000-000000000003'::uuid,'Noah','Patel',275),
  ('a0000000-0000-0000-0000-000000000004'::uuid,'Emma','Silva',260),
  ('a0000000-0000-0000-0000-000000000005'::uuid,'Mia','Chen',245),
  ('a0000000-0000-0000-0000-000000000006'::uuid,'Lucas','Kim',230),
  ('a0000000-0000-0000-0000-000000000007'::uuid,'Olivia','Rossi',215),
  ('a0000000-0000-0000-0000-000000000008'::uuid,'Ethan','Duval',200),
  ('a0000000-0000-0000-0000-000000000009'::uuid,'Sofia','Marin',185),
  ('a0000000-0000-0000-0000-000000000010'::uuid,'Aiden','Walsh',170),
  ('a0000000-0000-0000-0000-000000000011'::uuid,'Isla','Fischer',155),
  ('a0000000-0000-0000-0000-000000000012'::uuid,'Mateo','Ricci',140),
  ('a0000000-0000-0000-0000-000000000013'::uuid,'Chloe','Adeyemi',135),
  ('a0000000-0000-0000-0000-000000000014'::uuid,'Jack','Romano',130),
  ('a0000000-0000-0000-0000-000000000015'::uuid,'Zoe','Haddad',125),
  ('a0000000-0000-0000-0000-000000000016'::uuid,'Leo','Novak',110),
  ('a0000000-0000-0000-0000-000000000017'::uuid,'Nora','Bauer',95),
  ('a0000000-0000-0000-0000-000000000018'::uuid,'Owen','Reyes',75),
  ('a0000000-0000-0000-0000-000000000019'::uuid,'Ruby','Sato',45)
)
insert into profiles (id, first_name, last_name, email)
select id, first, last, 'seed-' || left(id::text, 8) || '@lista.internal'
from roster
where id <> '44444444-4444-4444-4444-444444444444'
on conflict (id) do nothing;

-- Land the login player on Dev FC.
update profiles set active_team_id = '33333333-3333-3333-3333-333333333333'
where id = '44444444-4444-4444-4444-444444444444';

-- Player memberships on Dev FC.
with roster(id) as (values
  ('44444444-4444-4444-4444-444444444444'::uuid),
  ('a0000000-0000-0000-0000-000000000001'::uuid),
  ('a0000000-0000-0000-0000-000000000002'::uuid),
  ('a0000000-0000-0000-0000-000000000003'::uuid),
  ('a0000000-0000-0000-0000-000000000004'::uuid),
  ('a0000000-0000-0000-0000-000000000005'::uuid),
  ('a0000000-0000-0000-0000-000000000006'::uuid),
  ('a0000000-0000-0000-0000-000000000007'::uuid),
  ('a0000000-0000-0000-0000-000000000008'::uuid),
  ('a0000000-0000-0000-0000-000000000009'::uuid),
  ('a0000000-0000-0000-0000-000000000010'::uuid),
  ('a0000000-0000-0000-0000-000000000011'::uuid),
  ('a0000000-0000-0000-0000-000000000012'::uuid),
  ('a0000000-0000-0000-0000-000000000013'::uuid),
  ('a0000000-0000-0000-0000-000000000014'::uuid),
  ('a0000000-0000-0000-0000-000000000015'::uuid),
  ('a0000000-0000-0000-0000-000000000016'::uuid),
  ('a0000000-0000-0000-0000-000000000017'::uuid),
  ('a0000000-0000-0000-0000-000000000018'::uuid),
  ('a0000000-0000-0000-0000-000000000019'::uuid)
)
insert into team_members (team_id, profile_id, role)
select '33333333-3333-3333-3333-333333333333', id, 'player' from roster
on conflict (team_id, profile_id) do nothing;

-- One training session per player, dated today in the team's timezone, against
-- the seeded "General" category. Deterministic id keeps re-runs idempotent.
with roster(id, minutes) as (values
  ('44444444-4444-4444-4444-444444444444'::uuid,120),
  ('a0000000-0000-0000-0000-000000000001'::uuid,300),
  ('a0000000-0000-0000-0000-000000000002'::uuid,290),
  ('a0000000-0000-0000-0000-000000000003'::uuid,275),
  ('a0000000-0000-0000-0000-000000000004'::uuid,260),
  ('a0000000-0000-0000-0000-000000000005'::uuid,245),
  ('a0000000-0000-0000-0000-000000000006'::uuid,230),
  ('a0000000-0000-0000-0000-000000000007'::uuid,215),
  ('a0000000-0000-0000-0000-000000000008'::uuid,200),
  ('a0000000-0000-0000-0000-000000000009'::uuid,185),
  ('a0000000-0000-0000-0000-000000000010'::uuid,170),
  ('a0000000-0000-0000-0000-000000000011'::uuid,155),
  ('a0000000-0000-0000-0000-000000000012'::uuid,140),
  ('a0000000-0000-0000-0000-000000000013'::uuid,135),
  ('a0000000-0000-0000-0000-000000000014'::uuid,130),
  ('a0000000-0000-0000-0000-000000000015'::uuid,125),
  ('a0000000-0000-0000-0000-000000000016'::uuid,110),
  ('a0000000-0000-0000-0000-000000000017'::uuid,95),
  ('a0000000-0000-0000-0000-000000000018'::uuid,75),
  ('a0000000-0000-0000-0000-000000000019'::uuid,45)
)
insert into training_sessions (id, profile_id, team_id, created_by, session_date, duration_minutes, category_id)
select
  md5('sess:' || id::text)::uuid, id,
  '33333333-3333-3333-3333-333333333333', id,
  (now() at time zone 'America/New_York')::date, minutes,
  (select id from training_categories
     where team_id = '33333333-3333-3333-3333-333333333333' and is_default limit 1)
from roster
on conflict (id) do nothing;

-- Locations for the schedule.
insert into locations (id, team_id, name, address) values
  ('55555555-5555-5555-5555-555555555001','33333333-3333-3333-3333-333333333333','Main Field','100 Stadium Way'),
  ('55555555-5555-5555-5555-555555555002','33333333-3333-3333-3333-333333333333','Community Gym','42 Center St')
on conflict (id) do nothing;

-- Schedule events. Local NY wall-clock times converted to timestamptz; dates
-- are offsets from today so the schedule always has past + upcoming entries.
insert into events (
  id, team_id, title, event_type, start_time, end_time, created_by, location_id,
  opponent, home_away, uniform, game_result, score_for, score_against, notes
)
select
  v.id, '33333333-3333-3333-3333-333333333333', v.title, v.event_type,
  (((now() at time zone 'America/New_York')::date + v.day_offset) + v.start_local) at time zone 'America/New_York',
  (((now() at time zone 'America/New_York')::date + v.day_offset) + v.end_local)   at time zone 'America/New_York',
  '11111111-1111-1111-1111-111111111111', v.location_id,
  v.opponent, v.home_away, v.uniform, v.game_result, v.score_for, v.score_against, v.notes
from (values
  ('66666666-6666-6666-6666-666666666001'::uuid, 'Team Meeting',   'other',    1,  time '19:00', time '19:45', '55555555-5555-5555-5555-555555555002'::uuid, null::text,          null::text,  null::text,  null::text, null::int, null::int, 'Season kickoff chat'),
  ('66666666-6666-6666-6666-666666666002'::uuid, 'Practice',       'practice', 2,  time '18:00', time '19:30', '55555555-5555-5555-5555-555555555001'::uuid, null,               null,        null,        null,       null,      null,      'Passing + finishing'),
  ('66666666-6666-6666-6666-666666666003'::uuid, 'Home vs Riverside United', 'game', 5, time '10:00', time '12:00', '55555555-5555-5555-5555-555555555001'::uuid, 'Riverside United', 'home',      'home',      null,       null,      null,      'Arrive 45 min early'),
  ('66666666-6666-6666-6666-666666666004'::uuid, 'Practice',       'practice', 9,  time '18:00', time '19:30', '55555555-5555-5555-5555-555555555001'::uuid, null,               null,        null,        null,       null,      null,      'Set pieces'),
  ('66666666-6666-6666-6666-666666666005'::uuid, 'Away @ North Valley', 'game', -4, time '10:00', time '12:00', '55555555-5555-5555-5555-555555555001'::uuid, 'North Valley',     'away',      'away',      'win',      3,         1,         'Great team result')
) as v(id, title, event_type, day_offset, start_local, end_local, location_id, opponent, home_away, uniform, game_result, score_for, score_against, notes)
on conflict (id) do nothing;

-- Availability RSVPs for every team member (players + coach) on every event.
-- Status is spread deterministically (~mostly available, some maybe/unavailable).
insert into availability (event_id, profile_id, status)
select
  e.id, r.profile_id,
  case (r.rn + e.ord) % 10
    when 0 then 'unavailable'
    when 1 then 'unavailable'
    when 2 then 'maybe'
    else 'available'
  end
from (values
  ('66666666-6666-6666-6666-666666666001'::uuid, 0),
  ('66666666-6666-6666-6666-666666666002'::uuid, 3),
  ('66666666-6666-6666-6666-666666666003'::uuid, 6),
  ('66666666-6666-6666-6666-666666666004'::uuid, 1),
  ('66666666-6666-6666-6666-666666666005'::uuid, 4)
) as e(id, ord)
cross join (
  select tm.profile_id, row_number() over (order by tm.profile_id) as rn
  from team_members tm
  where tm.team_id = '33333333-3333-3333-3333-333333333333'
) as r
on conflict (event_id, profile_id) do nothing;
