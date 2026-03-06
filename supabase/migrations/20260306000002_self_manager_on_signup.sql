-- When a new auth user is created, also insert a self-referencing profile_managers
-- row (manager_id = managed_id = new.id, relationship = 'Self').
-- This ensures every account holder appears in their own Contact Information section.

-- Backfill existing accounts that pre-date this migration.
insert into public.profile_managers (manager_id, managed_id, relationship)
select id, id, 'Self' from public.profiles
where auth_user_id is not null
on conflict (manager_id, managed_id) do nothing;

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

  insert into public.profile_managers (manager_id, managed_id, relationship)
  values (new.id, new.id, 'Self');

  return new;
end;
$$ language plpgsql security definer;
