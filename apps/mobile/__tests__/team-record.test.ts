/**
 * A team's record and latest result, as on the web (spec:
 * docs/specs/mobile-next-build.md §1, part 4; the web's
 * docs/specs/team-branding-and-labels.md §4). The cases are the web's own
 * (apps/web/tests/dashboard-team-card.test.tsx).
 */

import { teamRecord } from "../lib/team-record";
import { clubSecondaryColor, LISTA_BLUE } from "../lib/team-branding";

const NOW = new Date("2026-09-25T12:00:00Z");

function game(start: string, result: string | null, extra: Record<string, unknown> = {}) {
  return {
    start_time: start,
    timezone: "America/Los_Angeles",
    opponent: "Rivals FC",
    home_away: "home",
    game_result: result,
    score_for: null as number | null,
    score_against: null as number | null,
    ...extra,
  };
}

describe("teamRecord", () => {
  it("counts wins, losses and ties over games with a result", () => {
    const record = teamRecord(
      [
        game("2026-09-20T17:00:00Z", "win"),
        game("2026-09-13T17:00:00Z", "win"),
        game("2026-09-06T17:00:00Z", "loss"),
        game("2026-08-30T17:00:00Z", "tie"),
        game("2026-08-23T17:00:00Z", null),
      ],
      NOW
    );

    expect(record?.wins).toBe(2);
    expect(record?.losses).toBe(1);
    expect(record?.ties).toBe(1);
  });

  it("the last game is the latest one with a result, with its score when entered", () => {
    const record = teamRecord(
      [
        game("2026-09-13T17:00:00Z", "loss"),
        game("2026-09-20T17:00:00Z", "win", { score_for: 3, score_against: 1, home_away: "away", opponent: "Eagles" }),
        game("2026-09-24T17:00:00Z", null),
      ],
      NOW
    );

    expect(record?.last).toMatchObject({ result: "win", scoreFor: 3, scoreAgainst: 1, opponent: "Eagles", homeAway: "away" });
  });

  it("a game in the future doesn't count, even with a result entered", () => {
    const record = teamRecord([game("2026-09-20T17:00:00Z", "loss"), game("2026-10-01T17:00:00Z", "win")], NOW);

    expect(record).toMatchObject({ wins: 0, losses: 1, last: { result: "loss" } });
  });

  it("is null when no game has a result", () => {
    expect(teamRecord([game("2026-09-20T17:00:00Z", null)], NOW)).toBeNull();
    expect(teamRecord([], NOW)).toBeNull();
  });
});

describe("clubSecondaryColor", () => {
  const SLOFC = { name: "San Luis Obispo FC", org_name_public: "SLOFC", logo_url: null, plan: "club_small" };

  it("is a club's secondary brand color", () => {
    expect(clubSecondaryColor({ ...SLOFC, brand_color_secondary: "#C8102E" })).toBe("#C8102E");
  });

  it("is null for a free team's organization, or a club without one", () => {
    expect(clubSecondaryColor({ ...SLOFC, plan: "free", brand_color_secondary: "#C8102E" })).toBeNull();
    expect(clubSecondaryColor({ ...SLOFC, brand_color_secondary: null })).toBeNull();
    expect(clubSecondaryColor(null)).toBeNull();
  });

  it("is null unless the stored value is a hex color (the settings route doesn't check it)", () => {
    expect(clubSecondaryColor({ ...SLOFC, brand_color_secondary: "red; background: url(x)" })).toBeNull();
    expect(clubSecondaryColor({ ...SLOFC, brand_color_secondary: "#abc" })).toBe("#abc");
  });

  it("lista's own blue is the web's", () => {
    expect(LISTA_BLUE).toBe("#01D7F4");
  });
});
