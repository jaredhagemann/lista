-- Local development seed data.
--
-- Runs automatically after migrations on `supabase db reset` (config.toml ->
-- [db.seed] sql_paths = ["./seed.sql"]). This file is LOCAL-ONLY dev/test
-- scaffolding — it is never applied to staging or production (those go through
-- the migrate.yml PR flow), so hard-coded credentials here are safe.
--
-- Provides one ready-to-use, signed-in-able account for exercising club-tier
-- features (e.g. the Training Categories surface) in the UI without clicking
-- through signup + team creation + trial start every reset:
--
--   Login:  coach@lista.test  /  password123
--   Role:   coach on "Dev FC" (team admin) + owner of "Lista Dev Club" org
--   Plan:   club_small, subscription active (grants club access)
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
