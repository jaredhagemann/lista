-- Organizations (clubs) - for future multi-team support
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- Teams belong to an organization
create table teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  season text,
  created_at timestamptz default now()
);

-- Profiles extend Supabase auth.users
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  avatar_url text,
  created_at timestamptz default now()
);

-- Team membership with roles
create table team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  role text not null check (role in ('coach', 'manager', 'parent', 'player')),
  jersey_number int,
  created_at timestamptz default now(),
  unique(team_id, profile_id)
);

-- Events (practices, games, other)
create table events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  title text not null,
  description text,
  event_type text not null check (event_type in ('practice', 'game', 'other')),
  location text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  recurrence_rule text,
  parent_event_id uuid references events(id) on delete cascade,
  is_cancelled boolean default false,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- Availability responses
create table availability (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  status text not null check (status in ('available', 'unavailable', 'maybe')),
  created_at timestamptz default now(),
  unique(event_id, profile_id)
);

-- Team invitations
create table invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  email text not null,
  role text not null check (role in ('coach', 'manager', 'parent', 'player')),
  invited_by uuid references profiles(id),
  accepted_at timestamptz,
  created_at timestamptz default now()
);

-- Push notification subscriptions (for PWA)
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

-- Notification preferences
create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  email_enabled boolean default true,
  push_enabled boolean default true,
  created_at timestamptz default now(),
  unique(profile_id)
);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table organizations enable row level security;
alter table teams enable row level security;
alter table profiles enable row level security;
alter table team_members enable row level security;
alter table events enable row level security;
alter table availability enable row level security;
alter table invitations enable row level security;
alter table push_subscriptions enable row level security;
alter table notification_preferences enable row level security;

-- Helper: check if current user is a member of a team
create or replace function is_team_member(t_id uuid)
returns boolean as $$
  select exists (
    select 1 from team_members
    where team_id = t_id and profile_id = auth.uid()
  );
$$ language sql security definer;

-- Helper: check if current user is a coach/manager of a team
create or replace function is_team_admin(t_id uuid)
returns boolean as $$
  select exists (
    select 1 from team_members
    where team_id = t_id
      and profile_id = auth.uid()
      and role in ('coach', 'manager')
  );
$$ language sql security definer;

-- PROFILES
create policy "Users can view profiles of teammates"
  on profiles for select using (
    id = auth.uid()
    or exists (
      select 1 from team_members tm1
      join team_members tm2 on tm1.team_id = tm2.team_id
      where tm1.profile_id = auth.uid()
        and tm2.profile_id = profiles.id
    )
  );

create policy "Users can update own profile"
  on profiles for update using (id = auth.uid());

create policy "Users can insert own profile"
  on profiles for insert with check (id = auth.uid());

-- ORGANIZATIONS
create policy "Org visible to authenticated users"
  on organizations for select using (auth.uid() is not null);

create policy "Authenticated users can create orgs"
  on organizations for insert with check (auth.uid() is not null);

-- TEAMS
create policy "Teams visible to members"
  on teams for select using (is_team_member(id));

create policy "Teams editable by admins"
  on teams for update using (is_team_admin(id));

create policy "Teams insertable by authenticated users"
  on teams for insert with check (auth.uid() is not null);

-- TEAM MEMBERS
create policy "Team members visible to team"
  on team_members for select using (is_team_member(team_id));

create policy "Team members managed by admins"
  on team_members for insert with check (
    is_team_admin(team_id) or profile_id = auth.uid()
  );

create policy "Team members deletable by admins"
  on team_members for delete using (is_team_admin(team_id));

create policy "Team members updatable by admins"
  on team_members for update using (is_team_admin(team_id));

-- EVENTS
create policy "Events visible to team members"
  on events for select using (is_team_member(team_id));

create policy "Events created by admins"
  on events for insert with check (is_team_admin(team_id));

create policy "Events updated by admins"
  on events for update using (is_team_admin(team_id));

create policy "Events deleted by admins"
  on events for delete using (is_team_admin(team_id));

-- AVAILABILITY
create policy "Availability visible to team"
  on availability for select using (
    exists (
      select 1 from events e
      where e.id = availability.event_id
        and is_team_member(e.team_id)
    )
  );

create policy "Users manage own availability"
  on availability for insert with check (profile_id = auth.uid());

create policy "Users update own availability"
  on availability for update using (profile_id = auth.uid());

-- INVITATIONS
create policy "Invitations visible to team admins"
  on invitations for select using (is_team_admin(team_id));

create policy "Invitations created by team admins"
  on invitations for insert with check (is_team_admin(team_id));

create policy "Invitations updated by team admins"
  on invitations for update using (is_team_admin(team_id));

-- Allow invited users to view their own invitation by ID
create policy "Invited users can view own invitation"
  on invitations for select using (
    email = (auth.jwt() ->> 'email')
    or accepted_at is null  -- Allow public access to pending invitations for signup flow
  );

-- PUSH SUBSCRIPTIONS
create policy "Users manage own push subscriptions"
  on push_subscriptions for all using (profile_id = auth.uid());

-- NOTIFICATION PREFERENCES
create policy "Users manage own notification prefs"
  on notification_preferences for all using (profile_id = auth.uid());

-- ============================================================
-- Auto-create profile on signup
-- ============================================================
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
