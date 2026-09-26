import { isClubPlan } from "@/lib/plan";

/**
 * How a team is branded (spec: docs/specs/team-branding-and-labels.md §2–3).
 *
 * A team on a club plan inherits its club's logo unless it has its own, and is
 * named "[club] - [team]", the club being its Public Display Name, else its
 * internal name. Free teams also have an organization, but it carries no club
 * branding; a club that downgrades stops lending its branding, as its subdomain
 * and white-labelling already do.
 */

export type OrgBranding = {
  name?: string | null;
  org_name_public?: string | null;
  logo_url?: string | null;
  plan?: string | null;
};

export type BrandableTeam = {
  name: string;
  logo_url?: string | null;
  organizations?: OrgBranding | null;
};

export function teamBranding(team: BrandableTeam): {
  logoUrl: string | null;
  displayName: string;
  /** The club's name when the team is on a club, else null. */
  clubName: string | null;
} {
  const org = team.organizations;
  const club = org && isClubPlan(org.plan) ? org : null;
  const clubName = club ? club.org_name_public?.trim() || club.name?.trim() || null : null;
  return {
    logoUrl: team.logo_url || club?.logo_url || null,
    displayName: clubName ? `${clubName} - ${team.name}` : team.name,
    clubName,
  };
}
