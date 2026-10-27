-- Team mutes (docs/specs/team-notification-controls.md §3).
--
-- A member mutes one team without changing their account settings or their
-- other teams. A mute belongs to the adult who receives the notices: a
-- guardian mutes for themselves, never for a child, and a second guardian of
-- the same player keeps hearing from the team. No row means not muted.
--
-- Email and push are stored separately (D1) though Settings sets both, so the
-- two can be split later with a UI change only.
--
-- The team's coaches and managers can read its mutes (D4): they already see
-- each skipped delivery, with its profile and reason, in notification_deliveries.

create table team_notification_mutes (
  profile_id uuid not null references profiles(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  email_muted boolean not null default true,
  push_muted boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (profile_id, team_id)
);

-- The resolver reads a team's mutes for its recipients.
create index team_notification_mutes_team_idx on team_notification_mutes (team_id);

alter table team_notification_mutes enable row level security;

-- Only your own rows: a managed player's id is never auth.uid(), so no row can
-- name one. is_team_member covers a team reached through a managed player.
create policy "Members manage their own team mutes"
  on team_notification_mutes for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and is_team_member(team_id));

create policy "Team admins can view their team's mutes"
  on team_notification_mutes for select
  using (is_team_admin(team_id));
