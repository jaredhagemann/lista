-- Allow coaches/managers to insert or update availability for any member of their team's events
create policy "Admins manage team availability"
  on availability for all using (
    exists (
      select 1 from events e
      where e.id = availability.event_id
        and is_team_admin(e.team_id)
    )
  ) with check (
    exists (
      select 1 from events e
      where e.id = availability.event_id
        and is_team_admin(e.team_id)
    )
  );

-- Allow users to delete their own availability
create policy "Users delete own availability"
  on availability for delete using (profile_id = auth.uid());

-- Allow coaches/managers to delete any member's availability for their team's events
create policy "Admins delete team availability"
  on availability for delete using (
    exists (
      select 1 from events e
      where e.id = availability.event_id
        and is_team_admin(e.team_id)
    )
  );
