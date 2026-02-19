-- Allow team admins (coaches/managers) to INSERT, UPDATE, and DELETE
-- contacts for members on their team.

-- Helper: returns true if auth.uid() is a coach or manager on any team
-- that the given profile_id also belongs to.
create or replace function is_admin_of_profile(p_id uuid)
returns boolean as $$
  select exists (
    select 1 from team_members tm_admin
    join team_members tm_target on tm_admin.team_id = tm_target.team_id
    where tm_admin.profile_id = auth.uid()
      and tm_admin.role in ('coach', 'manager')
      and tm_target.profile_id = p_id
  );
$$ language sql security definer stable;

-- Replace INSERT policy: own profile OR admin of the profile's team
drop policy "Users can insert own contacts" on contacts;
create policy "Users can insert own contacts"
  on contacts for insert with check (
    profile_id = auth.uid()
    or is_admin_of_profile(profile_id)
  );

-- Replace UPDATE policy: own profile OR admin of the profile's team
drop policy "Users can update own contacts" on contacts;
create policy "Users can update own contacts"
  on contacts for update using (
    profile_id = auth.uid()
    or is_admin_of_profile(profile_id)
  );

-- Replace DELETE policy: own profile OR admin of the profile's team
drop policy "Users can delete own contacts" on contacts;
create policy "Users can delete own contacts"
  on contacts for delete using (
    profile_id = auth.uid()
    or is_admin_of_profile(profile_id)
  );
