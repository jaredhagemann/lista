-- ── Team owner ────────────────────────────────────────────────────────────────
-- Adds an owner_id column to teams. The owner is the single user with authority
-- to delete the team or transfer ownership. They must always hold a real auth
-- account (profiles.auth_user_id IS NOT NULL).

alter table teams
  add column owner_id uuid references profiles(id) on delete set null;

-- Backfill: set owner_id to the first auth-backed coach or manager per team.
-- Teams with no eligible members are left NULL (safe default; app enforces
-- owner_id is set at creation time going forward).
update teams t
set owner_id = (
  select tm.profile_id
  from team_members tm
  join profiles p on p.id = tm.profile_id
  where tm.team_id = t.id
    and tm.role in ('coach', 'manager')
    and p.auth_user_id is not null
  order by tm.created_at
  limit 1
)
where t.owner_id is null;

-- ── Trigger: enforce owner_id invariants ──────────────────────────────────────
-- Fires on INSERT and UPDATE OF owner_id. Enforces two rules:
--   1. If owner_id is non-null, it must reference a profile with auth_user_id
--      IS NOT NULL (managed/no-auth profiles may never become team owner).
--   2. On UPDATE, only service-role sessions may change owner_id. Authenticated
--      client sessions are blocked — ownership transfer must go through the
--      server action which uses the service role key.

create or replace function enforce_owner_id()
returns trigger
language plpgsql
security definer
as $$
declare
  owner_auth_user_id uuid;
begin
  -- Rule 1: validate the incoming owner is auth-backed.
  if new.owner_id is not null then
    select auth_user_id into owner_auth_user_id
    from profiles
    where id = new.owner_id;

    if owner_auth_user_id is null then
      raise exception 'owner_id must reference a profile with a real auth account (auth_user_id IS NOT NULL)';
    end if;
  end if;

  -- Rule 2: block authenticated sessions from directly updating owner_id.
  -- Ownership transfer must go through the server action (service role).
  -- INSERT is allowed so team creation can set owner_id client-side.
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    if auth.role() = 'authenticated' then
      raise exception 'owner_id can only be changed via a server action';
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_owner_id_trigger
  before insert or update of owner_id on teams
  for each row execute function enforce_owner_id();
