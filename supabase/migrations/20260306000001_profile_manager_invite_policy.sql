-- Allow profile managers to send invitations for players they manage.
-- is_managed_by_me() already exists from the managed_profiles migration.
create policy "profile_managers_can_send_invitations"
  on invitations for insert
  with check (
    is_team_admin(team_id)
    or (
      managed_profile_id is not null
      and is_managed_by_me(managed_profile_id)
    )
  );
