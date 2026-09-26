// @vitest-environment jsdom
/**
 * The dashboard's Team card (spec: docs/specs/team-branding-and-labels.md §4).
 *
 * The Team card leads with the team's logo (its own, or its club's), then its
 * name, club and season, then its members by name and role (coaches and staff
 * first, then players, each linking to their page), the member count and the
 * roster link; a team without a logo shows its initials.
 *
 * Beside it, the Record card: the last game as a two-line scoreline (the team,
 * then "vs"/"at" the opponent, each with its score) with its date and time, and
 * the wins, losses and ties over every game with a result, with a bar split in
 * those proportions. It appears once a game has a result.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { teamRecord } from "@/lib/events/team-record";

// ── The record ────────────────────────────────────────────────────────────────

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

  it("is null when no game has a result", () => {
    expect(teamRecord([game("2026-09-20T17:00:00Z", null)], NOW)).toBeNull();
    expect(teamRecord([], NOW)).toBeNull();
  });
});

// ── The card, on the dashboard ────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const from = (table: string) => {
    let results = false;
    const chain: Record<string, unknown> = {};
    const data = () => {
      if (table === "events") return results ? tables.results ?? [] : tables.upcoming ?? [];
      return tables[table] ?? null;
    };
    const result = () => Promise.resolve({ data: data(), error: null, count: tables.memberCount ?? 0 });
    for (const m of ["select", "eq", "neq", "in", "gte", "lte", "order", "limit", "is"]) chain[m] = () => chain;
    chain.not = (column: string) => {
      if (column === "game_result") results = true;
      return chain;
    };
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown) => result().then(res);
    return chain;
  };
  return {
    tables,
    membership: null as unknown,
    client: { from, auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) } },
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));
vi.mock("@/lib/get-active-membership", () => ({ getActiveMembership: async () => mocks.membership }));
vi.mock("@/components/team/create-team-form", () => ({ CreateTeamForm: () => null }));

import DashboardPage from "@/app/dashboard/page";

const TEAM = {
  id: "team-1",
  name: "12U Girls",
  season: "Fall 2026",
  logo_url: null,
  timezone: "America/Los_Angeles",
  organization_id: "org-1",
};
function member(id: string, role: string, first: string, last: string) {
  return { id, role, profiles: { first_name: first, last_name: last } };
}
const MEMBERS = [
  member("m-1", "player", "Zoey", "Butler"),
  member("m-2", "manager", "Pat", "Lee"),
  member("m-3", "player", "Ava", "Chen"),
  member("m-4", "coach", "Sam", "Okafor"),
];
const SLOFC = { name: "San Luis Obispo FC", org_name_public: "SLOFC", logo_url: "https://x/slofc.png", plan: "club_small" };

beforeEach(() => {
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.membership = { team_id: "team-1", role: "coach", profile_id: "coach-1", teams: TEAM };
  mocks.tables.organizations = SLOFC;
  mocks.tables.team_members = MEMBERS;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function card() {
  return screen.getByRole("region", { name: "Team" });
}

describe("the Team card", () => {
  it("leads with the team's logo, then its name, club and season", async () => {
    render(await DashboardPage());

    const logo = within(card()).getByRole("img", { name: "SLOFC - 12U Girls logo" });
    expect(logo.getAttribute("src")).toBe("https://x/slofc.png");
    expect(within(card()).getByText("12U Girls")).toBeTruthy();
    expect(within(card()).getByText("SLOFC · Fall 2026")).toBeTruthy();
  });

  it("leaves the record to the Record card", async () => {
    mocks.tables.results = [game("2026-09-20T17:00:00Z", "win", { score_for: 3, score_against: 1 })];

    render(await DashboardPage());

    expect(within(card()).queryByText(/Record|Last/)).toBeNull();
  });

  it("lists the members by name and role: coaches and staff first, then players by name", async () => {
    render(await DashboardPage());

    const list = within(card()).getByRole("list", { name: "Members" });
    const rows = within(list).getAllByRole("listitem").map((item) => item.textContent);
    expect(rows).toEqual(["Sam OkaforCoach", "Pat LeeManager", "Ava ChenPlayer", "Zoey ButlerPlayer"]);
  });

  it("each name links to the member's page", async () => {
    render(await DashboardPage());

    const link = within(card()).getByRole("link", { name: "Ava Chen" });
    expect(link.getAttribute("href")).toBe("/dashboard/team/m-3");
  });

  it("still shows the member count and roster link", async () => {
    render(await DashboardPage());

    expect(within(card()).getByText(/4 members/)).toBeTruthy();
    expect(within(card()).getByRole("link", { name: /View roster/ })).toBeTruthy();
  });

  it("a team with no logo shows its initials", async () => {
    mocks.tables.organizations = { ...SLOFC, logo_url: null };

    render(await DashboardPage());

    expect(within(card()).queryByRole("img")).toBeNull();
    expect(within(card()).getByText("1G")).toBeTruthy();
  });
});

// ── The Record card ───────────────────────────────────────────────────────────

function recordCard() {
  return screen.getByRole("region", { name: "Record" });
}

/** The number shown over a Wins/Losses/Ties label. */
function stat(label: string) {
  return within(recordCard()).getByText(label).parentElement!.textContent!.replace(label, "");
}

describe("the Record card", () => {
  it("shows the last game as a scoreline: the team and its score, then the opponent and theirs", async () => {
    mocks.tables.results = [
      game("2026-09-20T17:00:00Z", "win", { score_for: 3, score_against: 1 }),
      game("2026-09-13T17:00:00Z", "loss"),
    ];

    render(await DashboardPage());

    const record = recordCard();
    expect(within(record).getByText("Last game")).toBeTruthy();
    const [ours, theirs] = within(record).getAllByRole("row");
    expect(ours.textContent).toBe("12U Girls3");
    expect(theirs.textContent).toBe("vs Rivals FC1");
    expect(within(record).getByText("Sun, Sep 20, 10:00 AM PDT")).toBeTruthy();
  });

  it("an away game reads 'at' the opponent", async () => {
    mocks.tables.results = [
      game("2026-09-20T17:00:00Z", "loss", { score_for: 0, score_against: 2, home_away: "away", opponent: "Eagles" }),
    ];

    render(await DashboardPage());

    expect(within(recordCard()).getAllByRole("row")[1].textContent).toBe("at Eagles2");
  });

  it("without a score, the team's line shows the result", async () => {
    mocks.tables.results = [game("2026-09-20T17:00:00Z", "tie")];

    render(await DashboardPage());

    const [ours, theirs] = within(recordCard()).getAllByRole("row");
    expect(ours.textContent).toBe("12U GirlsTie");
    expect(theirs.textContent).toBe("vs Rivals FC");
  });

  it("counts wins, losses and ties, with a bar split in those proportions", async () => {
    mocks.tables.results = [
      game("2026-09-20T17:00:00Z", "win"),
      game("2026-09-13T17:00:00Z", "win"),
      game("2026-09-06T17:00:00Z", "loss"),
      game("2026-08-30T17:00:00Z", "tie"),
    ];

    render(await DashboardPage());

    expect(stat("Wins")).toBe("2");
    expect(stat("Losses")).toBe("1");
    expect(stat("Ties")).toBe("1");
    const bar = within(recordCard()).getByRole("img", { name: "2 wins, 1 loss, 1 tie" });
    const widths = Array.from(bar.children).map((segment) => (segment as HTMLElement).style.width);
    expect(widths).toEqual(["50%", "25%", "25%"]);
  });

  it("isn't shown until a game has a result", async () => {
    render(await DashboardPage());

    expect(screen.queryByRole("region", { name: "Record" })).toBeNull();
  });
});
