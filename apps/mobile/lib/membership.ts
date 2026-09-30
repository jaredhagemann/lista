import type { ActiveMembership, TeamMemberRow } from "../contexts/AppContext";
import { teamBranding } from "./team-branding";

/**
 * The active membership the screens read. A club team's logo falls back to the
 * club's, and `displayName` is "[club] - [team]" for the places a team is
 * picked; `teamName` stays the team's own name.
 */
export function rowToMembership(m: TeamMemberRow): ActiveMembership {
  const brand = teamBranding(m.teams);
  return {
    profileId: m.profile_id,
    teamId: m.team_id,
    teamName: m.teams.name,
    displayName: brand.displayName,
    season: m.teams.season,
    logoUrl: brand.logoUrl,
    role: m.role,
    homeUniform: m.teams.home_uniform,
    awayUniform: m.teams.away_uniform,
  };
}
