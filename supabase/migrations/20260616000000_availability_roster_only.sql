-- ============================================================
-- Availability: restrict writes to roster members of the event's team
-- ============================================================
-- Previously a user could insert/update an availability row for their own
-- profile (profile_id = auth.uid()) on ANY event they could see — including
-- events on teams they don't belong to. A parent-only manager can see a team's
-- events via their child (is_team_member resolves through profile_managers),
-- so an RSVP that mistakenly used the parent's own profile_id was accepted.
-- The iOS app then rendered the parent as "available" (it lists raw availability
-- rows by profile name) while the web roster view dropped the row entirely
-- (it only maps availability onto team_members), showing the player as
-- "No Response".
--
-- Availability is inherently per-roster-member, so require that the target
-- profile_id is a team_members row for the event's team. This closes the hole
-- for both the web and mobile write paths regardless of which profile the
-- client sends.

-- Helper: is the given profile a roster member of the given event's team?
-- security definer so the membership lookup bypasses RLS, consistent with
-- is_team_member / is_team_admin.
create or replace function is_event_team_member(e_id uuid, p_id uuid)
returns boolean as $$
  select exists (
    select 1
    from events e
    join team_members tm on tm.team_id = e.team_id
    where e.id = e_id
      and tm.profile_id = p_id
  );
$$ language sql security definer stable;

-- Tighten the self/managed insert policy to also require roster membership.
drop policy "Users manage own or managed availability" on availability;
create policy "Users manage own or managed availability"
  on availability for insert with check (
    (profile_id = auth.uid() or is_managed_by_me(profile_id))
    and is_event_team_member(event_id, profile_id)
  );

-- Same requirement on update.
drop policy "Users update own or managed availability" on availability;
create policy "Users update own or managed availability"
  on availability for update using (
    (profile_id = auth.uid() or is_managed_by_me(profile_id))
    and is_event_team_member(event_id, profile_id)
  );
