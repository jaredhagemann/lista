import { teamBranding, type OrgBranding } from "@/lib/team-branding";

export type MutableTeam = {
  id: string;
  name: string;
  /** Set only for a team in a club-plan org, with the club's public name. */
  club?: { id: string; name: string } | null;
};

/**
 * A team as Settings lists it: a club team carries its club (§3.4), named as
 * the header and team picker name it (team-branding-and-labels).
 */
export function mutableTeam(team: {
  id: string;
  name: string;
  organization_id: string | null;
  organizations?: OrgBranding | null;
}): MutableTeam {
  const { clubName } = teamBranding(team);
  const club = clubName && team.organization_id ? { id: team.organization_id, name: clubName } : null;
  return { id: team.id, name: team.name, club };
}
