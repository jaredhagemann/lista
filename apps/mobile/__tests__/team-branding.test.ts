/**
 * Club teams wear their club's branding (spec: docs/specs/mobile-next-build.md §1,
 * the web's docs/specs/team-branding-and-labels.md §2–3).
 *
 * A team on a club plan inherits the club's logo unless it has its own, and is
 * named "[club] - [team]" where teams are picked. Free teams have an
 * organization too, but no club branding. The cases are the web's own
 * (apps/web/tests/team-branding.test.tsx), so both apps follow one rule.
 */

import { teamBranding } from "../lib/team-branding";
import { rowToMembership } from "../lib/membership";

const CLUB_LOGO = "https://x.supabase.co/storage/v1/object/public/org-logos/slofc.png";
const TEAM_LOGO = "https://x.supabase.co/storage/v1/object/public/team-images/t1.png";

const SLOFC = { name: "San Luis Obispo FC", org_name_public: "SLOFC", logo_url: CLUB_LOGO, plan: "club_small" };

describe("teamBranding", () => {
  it("a club team without its own logo inherits the club's, and is prefixed by the club's public name", () => {
    expect(teamBranding({ name: "12U Girls", logo_url: null, organizations: SLOFC })).toEqual({
      logoUrl: CLUB_LOGO,
      displayName: "SLOFC - 12U Girls",
      clubName: "SLOFC",
    });
  });

  it("a team's own logo beats the club's", () => {
    expect(teamBranding({ name: "12U Girls", logo_url: TEAM_LOGO, organizations: SLOFC }).logoUrl).toBe(TEAM_LOGO);
  });

  it("without a public name, the club's internal name prefixes the team", () => {
    expect(
      teamBranding({ name: "12U Girls", logo_url: null, organizations: { ...SLOFC, org_name_public: null } }).displayName
    ).toBe("San Luis Obispo FC - 12U Girls");
  });

  it("the large club plan counts too", () => {
    expect(
      teamBranding({ name: "12U Girls", logo_url: null, organizations: { ...SLOFC, plan: "club_large" } }).clubName
    ).toBe("SLOFC");
  });

  it("a free team's organization lends neither logo nor name", () => {
    const free = { name: "12U Girls", logo_url: CLUB_LOGO, plan: "free", org_name_public: "SLOFC" };
    expect(teamBranding({ name: "12U Girls", logo_url: null, organizations: free })).toEqual({
      logoUrl: null,
      displayName: "12U Girls",
      clubName: null,
    });
  });

  it("a team with no organization loaded is just itself", () => {
    expect(teamBranding({ name: "12U Girls", logo_url: TEAM_LOGO })).toEqual({
      logoUrl: TEAM_LOGO,
      displayName: "12U Girls",
      clubName: null,
    });
  });
});

describe("the active membership", () => {
  const row = (organizations: unknown) =>
    ({
      id: "m-1",
      team_id: "t-1",
      profile_id: "p-1",
      role: "coach",
      teams: {
        id: "t-1",
        name: "12U Girls",
        season: "Fall 2026",
        logo_url: null,
        home_uniform: null,
        away_uniform: null,
        organizations,
      },
      profiles: {} as never,
    }) as never;

  it("carries a club team's branded name and inherited logo, and keeps the team's own name", () => {
    expect(rowToMembership(row(SLOFC))).toMatchObject({
      teamName: "12U Girls",
      displayName: "SLOFC - 12U Girls",
      logoUrl: CLUB_LOGO,
    });
  });

  it("a free team is just itself", () => {
    expect(rowToMembership(row({ ...SLOFC, plan: "free" }))).toMatchObject({
      teamName: "12U Girls",
      displayName: "12U Girls",
      logoUrl: null,
    });
  });
});
