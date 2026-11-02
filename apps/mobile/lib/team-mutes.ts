/**
 * The teams in the notification settings' Teams section: the web's rules, copied
 * (spec: docs/specs/team-notification-controls.md §3.1, §3.4). Keep in step with
 * apps/web/src/lib/notifications/mutable-team.ts and
 * apps/web/src/components/settings/team-mutes-section.tsx.
 */

import { teamBranding, type OrgBranding } from "./team-branding";

export type MutableTeam = {
  id: string;
  name: string;
  /** Set only for a team in a club-plan org, with the club's public name. */
  club: { id: string; name: string } | null;
};

export type TeamGroup = { key: string; heading: string | null; teams: MutableTeam[] };

type Membership = {
  teams: {
    id: string;
    name: string;
    organization_id?: string | null;
    archived_at?: string | null;
    organizations?: OrgBranding | null;
  } | null;
};

/** Every team the account hears from, its own or a managed player's, once each. Archived teams send nothing. */
export function mutableTeams(memberships: Membership[]): MutableTeam[] {
  const teams = new Map<string, MutableTeam>();
  for (const { teams: team } of memberships) {
    if (!team || team.archived_at) continue;
    const { clubName } = teamBranding(team);
    const club = clubName && team.organization_id ? { id: team.organization_id, name: clubName } : null;
    teams.set(team.id, { id: team.id, name: team.name, club });
  }
  return [...teams.values()];
}

/** "Club · Team", unless the team's name already starts with the club's. */
export function teamLabel(team: MutableTeam): string {
  const club = team.club?.name;
  if (!club || team.name.toLowerCase().startsWith(club.toLowerCase())) return team.name;
  return `${club} · ${team.name}`;
}

/** Clubs A–Z, then the teams in no club, each list A–Z. No headings when no team is in a club. */
export function groupByClub(teams: MutableTeam[]): TeamGroup[] {
  const byName = (a: MutableTeam, b: MutableTeam) => a.name.localeCompare(b.name);
  const clubs = new Map<string, TeamGroup>();
  const others: MutableTeam[] = [];
  for (const team of teams) {
    if (!team.club) {
      others.push(team);
      continue;
    }
    const group = clubs.get(team.club.id) ?? { key: team.club.id, heading: team.club.name, teams: [] };
    group.teams.push(team);
    clubs.set(team.club.id, group);
  }
  const groups = [...clubs.values()].sort((a, b) => a.heading!.localeCompare(b.heading!));
  for (const group of groups) group.teams.sort(byName);
  if (others.length > 0) {
    groups.push({ key: "other", heading: groups.length > 0 ? "Other teams" : null, teams: others.sort(byName) });
  }
  return groups;
}
