-- ============================================================
-- Managed Profiles
-- ============================================================
-- Allows a single account holder (e.g. a parent) to manage one or more
-- profiles that have no corresponding auth.users entry (e.g. their children).
-- ============================================================

-- 1. Decouple profiles.id from auth.users
--    Add a separate auth_user_id column (nullable for managed profiles).
alter table profiles
  add column auth_user_id uuid unique references auth.users(id) on delete cascade;

-- Backfill: for all existing profiles, auth_user_id = id
update profiles set auth_user_id = id;

-- Drop the FK that requires profiles.id to exist in auth.users.
-- profiles.id remains the primary key; managed profiles get a fresh gen_random_uuid().
alter table profiles drop constraint profiles_id_fkey;

-- Update the signup trigger to also set auth_user_id = new.id
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, auth_user_id, first_name, last_name, email)
  values (
    new.id,
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', new.email),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.email
  );
  return new;
end;
$$ language plpgsql security definer;

-- ============================================================
-- 2. profile_managers table
-- ============================================================
create table profile_managers (
  id         uuid primary key default gen_random_uuid(),
  manager_id uuid not null references profiles(id) on delete cascade,
  managed_id uuid not null references profiles(id) on delete cascade,
  relationship text,
  created_at timestamptz default now(),
  unique(manager_id, managed_id)
);

alter table profile_managers enable row level security;

-- ============================================================
-- 3. Helper functions
-- ============================================================

-- Returns true if the calling auth user manages the given profile.
create or replace function is_managed_by_me(p_id uuid)
returns boolean as $$
  select exists (
    select 1 from profile_managers
    where manager_id = auth.uid()
      and managed_id = p_id
  );
$$ language sql security definer;

-- Extend is_team_member to also return true if the auth user manages
-- any profile that is a member of the team. This allows parents to read
-- team data (events, schedule, roster) for teams their child is on.
create or replace function is_team_member(t_id uuid)
returns boolean as $$
  select
    exists (
      select 1 from team_members
      where team_id = t_id and profile_id = auth.uid()
    )
    or exists (
      select 1 from team_members tm
      join profile_managers pm on pm.managed_id = tm.profile_id
      where tm.team_id = t_id
        and pm.manager_id = auth.uid()
    );
$$ language sql security definer;

-- ============================================================
-- 4. RLS policies: profile_managers
-- ============================================================

create policy "Managers can view their managed profiles"
  on profile_managers for select using (
    manager_id = auth.uid()
    or is_admin_of_profile(managed_id)
  );

create policy "Managers can add managed profiles"
  on profile_managers for insert with check (
    manager_id = auth.uid()
  );

create policy "Managers can remove managed profiles"
  on profile_managers for delete using (
    manager_id = auth.uid()
  );

-- ============================================================
-- 5. RLS policies: profiles — add managed profile support
-- ============================================================

-- Allow managers to update profiles they manage
drop policy "Users can update own profile" on profiles;
create policy "Users can update own or managed profiles"
  on profiles for update using (
    id = auth.uid()
    or is_managed_by_me(id)
  );

-- Allow managers to see profiles they manage (extend existing select policy)
drop policy "Users can view profiles of teammates" on profiles;
create policy "Users can view profiles of teammates or managed profiles"
  on profiles for select using (
    id = auth.uid()
    or exists (
      select 1 from team_members tm1
      join team_members tm2 on tm1.team_id = tm2.team_id
      where tm1.profile_id = auth.uid()
        and tm2.profile_id = profiles.id
    )
    or is_managed_by_me(id)
  );

-- ============================================================
-- 6. RLS policies: availability — add managed profile support
-- ============================================================

drop policy "Users manage own availability" on availability;
create policy "Users manage own or managed availability"
  on availability for insert with check (
    profile_id = auth.uid()
    or is_managed_by_me(profile_id)
  );

drop policy "Users update own availability" on availability;
create policy "Users update own or managed availability"
  on availability for update using (
    profile_id = auth.uid()
    or is_managed_by_me(profile_id)
  );

drop policy "Users delete own availability" on availability;
create policy "Users delete own or managed availability"
  on availability for delete using (
    profile_id = auth.uid()
    or is_managed_by_me(profile_id)
  );

-- ============================================================
-- 7. RLS policies: team_members — allow inserting managed profiles
-- ============================================================

drop policy "Team members managed by admins" on team_members;
create policy "Team members managed by admins"
  on team_members for insert with check (
    is_team_admin(team_id)
    or profile_id = auth.uid()
    or is_managed_by_me(profile_id)
  );

-- ============================================================
-- 8. RLS policies: notification_preferences — add managed profile support
-- ============================================================

drop policy "Users manage own notification prefs" on notification_preferences;
create policy "Users manage own or managed notification prefs"
  on notification_preferences for all using (
    profile_id = auth.uid()
    or is_managed_by_me(profile_id)
  );
