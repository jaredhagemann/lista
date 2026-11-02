/**
 * Which teams the app's Teams section lists, and how
 * (docs/specs/team-notification-controls.md §3.1, §3.4). The web's rules:
 * apps/web/tests/team-mutes-section.test.tsx.
 */

import { groupByClub, mutableTeams, teamLabel, type MutableTeam } from "../lib/team-mutes";

const SLOFC = { id: "org-slo", name: "San Luis Obispo Futbol Club" };
const ARROYO = { id: "org-arroyo", name: "Arroyo Grande SC" };

type Org = { name: string; org_name_public: string | null; plan: string } | null;

function membership(id: string, organizations: Org = null, extra: Record<string, unknown> = {}) {
  return {
    team_id: id,
    teams: { id, name: "U10 Girls", organization_id: organizations ? "org-1" : null, organizations, ...extra },
  };
}

describe("mutableTeams", () => {
  it("lists a team once, however many of the account's profiles are on it", () => {
    expect(mutableTeams([membership("t-1"), membership("t-1"), membership("t-2")]).map((t) => t.id)).toEqual([
      "t-1",
      "t-2",
    ]);
  });

  it("leaves out archived teams, and memberships whose team can't be read", () => {
    const archived = membership("t-1", null, { archived_at: "2026-10-01T00:00:00Z" });
    const unreadable = { team_id: "t-2", teams: null };

    expect(mutableTeams([archived, unreadable, membership("t-3")]).map((t) => t.id)).toEqual(["t-3"]);
  });

  it("a club-plan team takes the club's public name", () => {
    const [team] = mutableTeams([membership("t-1", { name: "SLO Futbol LLC", org_name_public: "SLOFC", plan: "club_small" })]);

    expect(team.club).toEqual({ id: "org-1", name: "SLOFC" });
  });

  it("falls back to the org name when the public name is blank", () => {
    const [team] = mutableTeams([membership("t-1", { name: "SLO Futbol LLC", org_name_public: "  ", plan: "club_large" })]);

    expect(team.club).toEqual({ id: "org-1", name: "SLO Futbol LLC" });
  });

  it("a free team isn't a club team, even with an org behind it", () => {
    const [free] = mutableTeams([membership("t-1", { name: "U10 Girls", org_name_public: null, plan: "free" })]);
    const [none] = mutableTeams([membership("t-2")]);

    expect(free.club).toBeNull();
    expect(none.club).toBeNull();
  });
});

describe("teamLabel", () => {
  it('names a club team "Club · Team"', () => {
    expect(teamLabel({ id: "t", name: "U10 Girls", club: { id: "o", name: "SLOFC" } })).toBe("SLOFC · U10 Girls");
  });

  it("doesn't repeat the club when the team name already starts with it", () => {
    expect(teamLabel({ id: "t", name: "slofc U10 Girls", club: { id: "o", name: "SLOFC" } })).toBe("slofc U10 Girls");
  });

  it("leaves other teams' names alone", () => {
    expect(teamLabel({ id: "t", name: "Rec Tuesdays", club: null })).toBe("Rec Tuesdays");
  });
});

describe("groupByClub", () => {
  const shape = (teams: MutableTeam[]) =>
    groupByClub(teams).map((g) => [g.heading, g.teams.map((t) => t.name)]);

  it("lists clubs A–Z with their teams, then the other teams, each A–Z", () => {
    expect(
      shape([
        { id: "1", name: "U12 Boys", club: SLOFC },
        { id: "2", name: "Rec Tuesdays", club: null },
        { id: "3", name: "U10 Girls", club: SLOFC },
        { id: "4", name: "U9 Mixed", club: ARROYO },
        { id: "5", name: "Alpha Pickup", club: null },
      ])
    ).toEqual([
      ["Arroyo Grande SC", ["U9 Mixed"]],
      ["San Luis Obispo Futbol Club", ["U10 Girls", "U12 Boys"]],
      ["Other teams", ["Alpha Pickup", "Rec Tuesdays"]],
    ]);
  });

  it("keeps two clubs with the same name apart", () => {
    const groups = groupByClub([
      { id: "1", name: "U10", club: { id: "org-1", name: "United" } },
      { id: "2", name: "U11", club: { id: "org-2", name: "United" } },
    ]);

    expect(groups).toHaveLength(2);
  });

  it("has no headings when no team is in a club", () => {
    expect(
      shape([
        { id: "1", name: "U12 Boys", club: null },
        { id: "2", name: "U10 Girls", club: null },
      ])
    ).toEqual([[null, ["U10 Girls", "U12 Boys"]]]);
  });
});
