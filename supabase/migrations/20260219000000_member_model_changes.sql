-- ============================================================
-- 1. Profile schema changes: split full_name, add birthday/gender
-- ============================================================

-- Rename full_name → first_name
alter table profiles rename column full_name to first_name;

-- Add new columns
alter table profiles add column last_name text not null default '';
alter table profiles add column birthday date;
alter table profiles add column gender text;

-- ============================================================
-- 2. Create contacts table
-- ============================================================

create table contacts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  relationship text not null,
  first_name text not null,
  last_name text not null default '',
  email text,
  phone text,
  street text,
  city text,
  state text,
  zip text,
  receives_email boolean default false,
  created_at timestamptz default now()
);

-- ============================================================
-- 3. Migrate existing phone data to "Self" contact rows
-- ============================================================

insert into contacts (profile_id, relationship, first_name, last_name, phone)
select id, 'Self', first_name, last_name, phone
from profiles
where phone is not null and phone != '';

-- ============================================================
-- 4. Drop phone column from profiles
-- ============================================================

alter table profiles drop column phone;

-- ============================================================
-- 5. Update role CHECK constraints (remove 'parent')
-- ============================================================

-- Delete existing parent team_members rows
delete from team_members where role = 'parent';

-- Delete existing parent invitations rows
delete from invitations where role = 'parent';

-- team_members: drop old constraint, add new
alter table team_members drop constraint if exists team_members_role_check;
alter table team_members add constraint team_members_role_check
  check (role in ('coach', 'manager', 'player'));

-- invitations: drop old constraint, add new
alter table invitations drop constraint if exists invitations_role_check;
alter table invitations add constraint invitations_role_check
  check (role in ('coach', 'manager', 'player'));

-- ============================================================
-- 6. RLS on contacts
-- ============================================================

alter table contacts enable row level security;

-- Own contacts: full CRUD
create policy "Users can insert own contacts"
  on contacts for insert with check (profile_id = auth.uid());

create policy "Users can view own contacts"
  on contacts for select using (
    profile_id = auth.uid()
    or exists (
      select 1 from team_members tm1
      join team_members tm2 on tm1.team_id = tm2.team_id
      where tm1.profile_id = auth.uid()
        and tm2.profile_id = contacts.profile_id
    )
  );

create policy "Users can update own contacts"
  on contacts for update using (profile_id = auth.uid());

create policy "Users can delete own contacts"
  on contacts for delete using (profile_id = auth.uid());

-- ============================================================
-- 7. Update handle_new_user() trigger: full_name → first_name
-- ============================================================

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, first_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', new.email),
    new.email
  );
  return new;
end;
$$ language plpgsql security definer;
