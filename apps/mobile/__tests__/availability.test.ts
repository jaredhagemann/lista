/**
 * Availability on the event screen, trimmed (spec: docs/specs/mobile-next-build.md
 * §1, part 3), following the web's ResponseList
 * (apps/web/src/components/availability/response-list.tsx).
 *
 * Players' answers are grouped by answer, and only players count: they're what
 * a coach checks to see whether there are enough for the game. Everyone else on
 * the roster is listed under "Coaches & staff" with their role. Tapping your
 * current answer again clears it.
 */

import { answerersFor, groupResponses, nextAvailability, type RosterMember } from "../lib/availability";

describe("nextAvailability", () => {
  it("chooses the tapped answer, and clears it when tapped again", () => {
    expect(nextAvailability(null, "available")).toBe("available");
    expect(nextAvailability("maybe", "available")).toBe("available");
    expect(nextAvailability("available", "available")).toBeNull();
  });
});

describe("groupResponses", () => {
  const roster: RosterMember[] = [
    { profileId: "p-ava", name: "Ava Chen", role: "player" },
    { profileId: "p-bea", name: "Bea Diaz", role: "player" },
    { profileId: "p-cam", name: "Cam Ellis", role: "player" },
    { profileId: "p-dev", name: "Dev Fox", role: null }, // no role: a player, as on the web
    { profileId: "c-kim", name: "Kim Lee", role: "coach" },
    { profileId: "m-sam", name: "Sam Park", role: "parent" },
  ];

  const answers = new Map([
    ["p-ava", "available"],
    ["p-bea", "maybe"],
    ["c-kim", "available"],
    ["gone", "available"], // answered, then left the team
  ] as const);

  it("groups players by answer, with everyone unanswered under No response", () => {
    const { groups } = groupResponses(roster, answers);

    expect(groups.available.map((m) => m.name)).toEqual(["Ava Chen"]);
    expect(groups.maybe.map((m) => m.name)).toEqual(["Bea Diaz"]);
    expect(groups.unavailable).toEqual([]);
    expect(groups.none.map((m) => m.name)).toEqual(["Cam Ellis", "Dev Fox"]);
  });

  it("lists everyone else under staff, with their answer and role", () => {
    const { staff } = groupResponses(roster, answers);

    expect(staff).toEqual([
      { profileId: "c-kim", name: "Kim Lee", role: "coach", status: "available", roleLabel: "Coach" },
      { profileId: "m-sam", name: "Sam Park", role: "parent", status: null, roleLabel: "Parent" },
    ]);
  });

  it("counts players only, and ignores answers from people no longer on the roster", () => {
    const { summary, playerCount } = groupResponses(roster, answers);

    expect(summary).toBe("1 available · 1 maybe");
    expect(playerCount).toBe(4);
  });

  it("sorts each group by name", () => {
    const { groups } = groupResponses(
      [
        { profileId: "z", name: "Zoe Young", role: "player" },
        { profileId: "a", name: "Abby Adams", role: "player" },
      ],
      new Map()
    );

    expect(groups.none.map((m) => m.name)).toEqual(["Abby Adams", "Zoe Young"]);
  });

  it("has no summary before anyone answers", () => {
    expect(groupResponses(roster, new Map()).summary).toBe("");
  });
});

describe("answerersFor", () => {
  const row = (teamId: string, profileId: string, first: string) => ({
    team_id: teamId,
    profile_id: profileId,
    profiles: { first_name: first, last_name: "Chen" },
  });
  // A parent (own profile "me") who manages Ava and Bea.
  const memberships = [
    row("t-ava", "p-ava", "Ava"),
    row("t-bea", "p-bea", "Bea"),
    row("t-both", "p-ava", "Ava"),
    row("t-both", "p-bea", "Bea"),
    row("t-coach", "me", "Dana"),
  ];

  it("answers as the profile being viewed when it's on the event's team", () => {
    expect(answerersFor("t-ava", memberships, "p-ava").answeringAs).toBe("p-ava");
    expect(answerersFor("t-both", memberships, "p-bea").answeringAs).toBe("p-bea");
  });

  it("answers as your one profile on the event's team when the one being viewed isn't on it (review of #105)", () => {
    const { answeringAs, choices } = answerersFor("t-bea", memberships, "p-ava");

    expect(answeringAs).toBe("p-bea");
    expect(choices).toEqual([{ profileId: "p-bea", name: "Bea Chen" }]);
  });

  it("asks which one when several of your profiles are on the team and the viewed one isn't", () => {
    const { answeringAs, choices } = answerersFor("t-both", memberships, "me");

    expect(answeringAs).toBeNull();
    expect(choices.map((c) => c.name)).toEqual(["Ava Chen", "Bea Chen"]);
  });

  it("offers no one when none of your profiles is on the team", () => {
    expect(answerersFor("t-other", memberships, "p-ava")).toEqual({ answeringAs: null, choices: [] });
  });
});
