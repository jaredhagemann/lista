-- Extend handle_new_user() (the on_auth_user_created trigger) to populate
-- profiles from Google OAuth metadata, per docs/specs/google-auth.md R4.
--
-- Derivation precedence (R4):
--   first_name : first_name  -> given_name  -> first token of name/full_name
--                                            -> email local-part
--   last_name  : last_name   -> family_name -> remainder of name/full_name
--                                            -> ''
--   avatar_url : raw_user_meta_data->>'picture' on first sign-in (only set when
--                currently null — see "no-clobber" note below).
--
-- Why the "only set when null" avatar contract is preserved by an INSERT-only
-- trigger: Supabase's automatic identity-linking attaches a new
-- auth.identities row to the EXISTING auth.users row and never inserts a
-- second auth.users row for an email that already has a confirmed user (pinned
-- by tests/rls/google-auth-linking.test.ts). The INSERT trigger therefore does
-- not re-fire on a returning Google sign-in, so an existing avatar_url cannot
-- be overwritten by Google's picture URL on subsequent sign-ins. The
-- ON CONFLICT clauses below are belt-and-suspenders for any pathological
-- double-fire (e.g. a re-run of the same INSERT inside a transaction): they
-- make both inserts no-ops on duplicate, never updating an existing row.
--
-- The 'Self' profile_managers row from
-- 20260306000002_self_manager_on_signup.sql is preserved verbatim — every
-- account holder must still appear in their own Contact Information section.

create or replace function handle_new_user()
returns trigger as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  combined_name text;
  name_parts text[];
  derived_first text;
  derived_last text;
  picture_url text;
begin
  -- Prefer Google's `name`; fall back to `full_name` if present. Trim so a
  -- trailing space doesn't create an empty trailing token after split.
  combined_name := nullif(trim(coalesce(meta->>'name', meta->>'full_name', '')), '');
  if combined_name is not null then
    name_parts := regexp_split_to_array(combined_name, '\s+');
  end if;

  derived_first := coalesce(
    nullif(meta->>'first_name', ''),
    nullif(meta->>'given_name', ''),
    case
      when name_parts is not null and array_length(name_parts, 1) >= 1
      then name_parts[1]
    end,
    split_part(new.email, '@', 1)
  );

  derived_last := coalesce(
    nullif(meta->>'last_name', ''),
    nullif(meta->>'family_name', ''),
    case
      when name_parts is not null and array_length(name_parts, 1) > 1
      then array_to_string(name_parts[2:], ' ')
    end,
    ''
  );

  picture_url := nullif(meta->>'picture', '');

  insert into public.profiles (id, auth_user_id, first_name, last_name, email, avatar_url)
  values (
    new.id,
    new.id,
    derived_first,
    derived_last,
    new.email,
    picture_url
  )
  on conflict (id) do nothing;

  insert into public.profile_managers (manager_id, managed_id, relationship)
  values (new.id, new.id, 'Self')
  on conflict (manager_id, managed_id) do nothing;

  return new;
end;
$$ language plpgsql security definer;
