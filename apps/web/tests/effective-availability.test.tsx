// @vitest-environment jsdom
/**
 * A game's answer, in a tournament (docs/specs/tournaments-and-leagues.md §4,
 * "Availability", D2): the game's own answer if there is one, else the
 * tournament's, else none.
 *
 *   - the shared rule, effectiveAnswer
 *   - a game's page: "Your availability" shows the inherited answer until one is
 *     set for the game; answering sets an override; clearing it goes back to the
 *     tournament's answer, never to "no answer"
 *   - a game's response list: answers for that game, inherited ones marked
 *     "from Surf Cup", counted like any other
 *   - a coach answering for a player sets that player's override
 *   - the tournament's own page, and a standalone game, are as before
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => {
  const writes: { kind: "upsert" | "delete"; row: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: [], error: null, count: 0 });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "or", "order", "in", "gte", "is", "limit"]) chain[m] = () => chain;
    const deleted: Record<string, unknown> = {};
    chain.eq = (column: string, value: unknown) => {
      deleted[column] = value;
      if (deleted.event_id && deleted.profile_id && table === "availability") {
        writes.push({ kind: "delete", row: { ...deleted } });
      }
      return chain;
    };
    chain.delete = () => chain;
    chain.upsert = (row: Record<string, unknown>) => {
      writes.push({ kind: "upsert", row });
      return Promise.resolve({ error: null });
    };
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return chain;
  };
  return {
    writes,
    client: {
      from,
      rpc: async () => ({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notifications/client", () => ({
  drainNotifications: vi.fn(async () => null),
  withNotice: (message: string) => message,
}));

import { EventDetail } from "@/components/calendar/event-detail";
import { effectiveAnswer } from "@/lib/availability/effective";

const LA = "America/Los_Angeles";
const TEAM = { name: "U10 Girls", home_uniform: null, away_uniform: null, home_uniform_color: null, away_uniform_color: null };

function event(overrides: Record<string, unknown>) {
  return {
    id: "g-1",
    team_id: "team-1",
    title: "Game",
    event_type: "game",
    start_time: "2026-12-12T17:00:00.000Z",
    end_time: "2026-12-12T18:30:00.000Z",
    timezone: LA,
    is_cancelled: false,
    location_id: null,
    locations: null,
    arrival_time: null,
    notes: null,
    opponent: "Rivals FC",
    home_away: "home",
    uniform: null,
    game_result: null,
    score_for: null,
    score_against: null,
    recurrence_rule: null,
    parent_event_id: null,
    tournament_id: "t-1",
    round: "Pool A",
    placement_rank: null,
    placement_label: null,
    tournament: { id: "t-1", title: "Surf Cup" },
    created_by: null,
    created_at: null,
    ...overrides,
  };
}

const MEMBERS = [
  { profileId: "ava", name: "Ava Smith", role: "player" },
  { profileId: "zoey", name: "Zoey Butler", role: "player" },
  { profileId: "mia", name: "Mia Chen", role: "player" },
];

type Answer = { profileId: string; status: "available" | "maybe" | "unavailable" };

function renderGame({
  viewer = "ava",
  isAdmin = false,
  gameAnswers = [] as Answer[],
  tournamentAnswers = [] as Answer[],
  ev = event({}),
} = {}) {
  return render(
    <EventDetail
      event={ev as never}
      isAdmin={isAdmin}
      creatorName="Coach Kim"
      team={TEAM}
      teamTimeZone={LA}
      currentUserId={viewer}
      availabilityRows={gameAnswers}
      tournamentAnswers={tournamentAnswers}
      members={MEMBERS}
    />
  );
}

const yourPicker = () => screen.getByRole("group", { name: "Your availability" });
const pressed = (group: HTMLElement) =>
  within(group)
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.getAttribute("aria-label"));
const groupOf = (name: string) => screen.getByText(name).closest("[data-group]")!.getAttribute("data-group");
const rowOf = (name: string) => screen.getByText(name).closest("[data-member-row]") as HTMLElement;

beforeEach(() => {
  mocks.writes.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-04T20:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("effectiveAnswer", () => {
  it("is the game's own answer when there is one", () => {
    expect(effectiveAnswer("maybe", "available")).toEqual({ status: "maybe", inherited: false });
    expect(effectiveAnswer("unavailable", null)).toEqual({ status: "unavailable", inherited: false });
  });

  it("else the tournament's, marked as inherited", () => {
    expect(effectiveAnswer(null, "available")).toEqual({ status: "available", inherited: true });
    expect(effectiveAnswer(undefined, "unavailable")).toEqual({ status: "unavailable", inherited: true });
  });

  it("else none", () => {
    expect(effectiveAnswer(null, null)).toEqual({ status: null, inherited: false });
    expect(effectiveAnswer(undefined, undefined)).toEqual({ status: null, inherited: false });
  });
});

describe("Your availability, on a game in a tournament", () => {
  it("shows your tournament answer until you set one for the game", () => {
    renderGame({ tournamentAnswers: [{ profileId: "ava", status: "available" }] });

    expect(pressed(yourPicker())).toEqual(["Available"]);
    expect(screen.getByText(/From your Surf Cup answer/)).toBeTruthy();
  });

  it("answering sets this game's own answer, an override", async () => {
    renderGame({ tournamentAnswers: [{ profileId: "ava", status: "available" }] });
    const user = userEvent.setup();
    await user.click(within(yourPicker()).getByRole("button", { name: "Unavailable" }));

    await waitFor(() =>
      expect(mocks.writes).toEqual([
        { kind: "upsert", row: { event_id: "g-1", profile_id: "ava", status: "unavailable" } },
      ])
    );
    expect(pressed(yourPicker())).toEqual(["Unavailable"]);
    expect(screen.getByText(/Set for this game/)).toBeTruthy();
  });

  it("choosing the inherited answer keeps it for this game too", async () => {
    renderGame({ tournamentAnswers: [{ profileId: "ava", status: "available" }] });
    const user = userEvent.setup();
    await user.click(within(yourPicker()).getByRole("button", { name: "Available" }));

    await waitFor(() =>
      expect(mocks.writes).toEqual([
        { kind: "upsert", row: { event_id: "g-1", profile_id: "ava", status: "available" } },
      ])
    );
    expect(screen.getByText(/Set for this game/)).toBeTruthy();
  });

  it("clearing the game's answer goes back to the tournament's, not to no answer", async () => {
    renderGame({
      gameAnswers: [{ profileId: "ava", status: "maybe" }],
      tournamentAnswers: [{ profileId: "ava", status: "available" }],
    });
    expect(pressed(yourPicker())).toEqual(["Maybe"]);

    const user = userEvent.setup();
    await user.click(within(yourPicker()).getByRole("button", { name: "Maybe" }));

    await waitFor(() =>
      expect(mocks.writes).toEqual([{ kind: "delete", row: { event_id: "g-1", profile_id: "ava" } }])
    );
    expect(pressed(yourPicker())).toEqual(["Available"]);
    expect(screen.getByText(/From your Surf Cup answer/)).toBeTruthy();
  });

  it("with no tournament answer either, it's unanswered, as for any event", () => {
    renderGame();

    expect(pressed(yourPicker())).toEqual([]);
    expect(screen.queryByText(/From your Surf Cup answer/)).toBeNull();
  });
});

describe("a game's response list, in a tournament", () => {
  it("groups everyone by their resulting answer, marking inherited ones", () => {
    renderGame({
      viewer: "coach-1",
      gameAnswers: [{ profileId: "zoey", status: "unavailable" }],
      tournamentAnswers: [
        { profileId: "ava", status: "available" },
        { profileId: "zoey", status: "available" },
      ],
    });

    expect(groupOf("Ava Smith")).toBe("available");
    expect(within(rowOf("Ava Smith")).getByText("from Surf Cup")).toBeTruthy();
    // Zoey's own game answer wins over her tournament answer, and isn't marked.
    expect(groupOf("Zoey Butler")).toBe("unavailable");
    expect(within(rowOf("Zoey Butler")).queryByText("from Surf Cup")).toBeNull();
    expect(groupOf("Mia Chen")).toBe("none");
    expect(screen.getByText("1 available · 1 unavailable")).toBeTruthy();
  });

  it("your own answer, set above, shows in your row at once", async () => {
    renderGame({ tournamentAnswers: [{ profileId: "ava", status: "available" }] });
    expect(within(rowOf("Ava Smith")).getByText("from Surf Cup")).toBeTruthy();

    const user = userEvent.setup();
    await user.click(within(yourPicker()).getByRole("button", { name: "Maybe" }));

    await waitFor(() => expect(groupOf("Ava Smith")).toBe("maybe"));
    expect(within(rowOf("Ava Smith")).queryByText("from Surf Cup")).toBeNull();
  });

  it("a coach answering for a player sets that player's own answer for the game", async () => {
    renderGame({
      viewer: "coach-1",
      isAdmin: true,
      tournamentAnswers: [{ profileId: "ava", status: "available" }],
    });
    const avaPicker = screen.getByRole("group", { name: "Availability for Ava Smith" });
    expect(pressed(avaPicker)).toEqual(["Available"]);

    const user = userEvent.setup();
    await user.click(within(avaPicker).getByRole("button", { name: "Maybe" }));

    await waitFor(() =>
      expect(mocks.writes).toEqual([
        { kind: "upsert", row: { event_id: "g-1", profile_id: "ava", status: "maybe" } },
      ])
    );
    await waitFor(() => expect(groupOf("Ava Smith")).toBe("maybe"));
    expect(within(rowOf("Ava Smith")).queryByText("from Surf Cup")).toBeNull();
  });

  it("a coach clearing a player's game answer puts the tournament's back", async () => {
    renderGame({
      viewer: "coach-1",
      isAdmin: true,
      gameAnswers: [{ profileId: "ava", status: "unavailable" }],
      tournamentAnswers: [{ profileId: "ava", status: "available" }],
    });
    const user = userEvent.setup();
    const avaPicker = screen.getByRole("group", { name: "Availability for Ava Smith" });
    await user.click(within(avaPicker).getByRole("button", { name: "Unavailable" }));

    await waitFor(() => expect(groupOf("Ava Smith")).toBe("available"));
    expect(within(rowOf("Ava Smith")).getByText("from Surf Cup")).toBeTruthy();
  });
});

describe("unchanged outside a tournament's games", () => {
  it("a standalone game shows only its own answers", () => {
    renderGame({ ev: event({ tournament_id: null, tournament: null, round: null }), tournamentAnswers: [] });

    expect(screen.queryByText(/from Surf Cup|From your/)).toBeNull();
    expect(groupOf("Ava Smith")).toBe("none");
  });

  it("the tournament's own page shows the tournament's answers, unmarked", () => {
    renderGame({
      ev: event({
        id: "t-1",
        title: "Surf Cup",
        event_type: "tournament",
        start_time: "2026-12-11T08:00:00.000Z",
        end_time: "2026-12-14T08:00:00.000Z",
        tournament_id: null,
        tournament: null,
        round: null,
        opponent: null,
        home_away: null,
      }),
      gameAnswers: [{ profileId: "ava", status: "available" }],
    });

    expect(groupOf("Ava Smith")).toBe("available");
    expect(screen.queryByText("from Surf Cup")).toBeNull();
    expect(pressed(yourPicker())).toEqual(["Available"]);
  });
});

// ── TL-016 (docs/reviews/2026-10-01-tournaments-and-leagues-review.md) ──

describe("TL-016: a refreshed page shows the tournament answers it was given", () => {
  // A refresh re-renders the same mounted page with new server props.
  function page(ev: unknown, tournamentAnswers: Answer[], gameAnswers: Answer[] = []) {
    return (
      <EventDetail
        event={ev as never}
        isAdmin={false}
        creatorName="Coach Kim"
        team={TEAM}
        teamTimeZone={LA}
        currentUserId="mia"
        availabilityRows={gameAnswers}
        tournamentAnswers={tournamentAnswers}
        members={MEMBERS}
      />
    );
  }

  it("a changed tournament answer moves the row, and the count", () => {
    const { rerender } = render(page(event({}), [{ profileId: "ava", status: "available" }]));
    expect(groupOf("Ava Smith")).toBe("available");

    rerender(page(event({}), [{ profileId: "ava", status: "unavailable" }]));

    expect(groupOf("Ava Smith")).toBe("unavailable");
    expect(within(rowOf("Ava Smith")).getByText("from Surf Cup")).toBeTruthy();
    expect(screen.getByText("1 unavailable")).toBeTruthy();
  });

  it("a cleared tournament answer leaves no answer", () => {
    const { rerender } = render(page(event({}), [{ profileId: "ava", status: "available" }]));

    rerender(page(event({}), []));

    expect(groupOf("Ava Smith")).toBe("none");
    expect(within(rowOf("Ava Smith")).queryByText("from Surf Cup")).toBeNull();
  });

  it("a game taken out of its tournament stops following it", () => {
    const { rerender } = render(page(event({}), [{ profileId: "ava", status: "available" }]));

    rerender(page(event({ tournament_id: null, tournament: null, round: null }), []));

    expect(groupOf("Ava Smith")).toBe("none");
    expect(screen.queryByText(/from Surf Cup/)).toBeNull();
  });

  it("a game moved to another tournament follows that one", () => {
    const { rerender } = render(page(event({}), [{ profileId: "ava", status: "available" }]));

    rerender(
      page(event({ tournament_id: "t-2", tournament: { id: "t-2", title: "Winter Cup" } }), [
        { profileId: "ava", status: "maybe" },
      ])
    );

    expect(groupOf("Ava Smith")).toBe("maybe");
    expect(within(rowOf("Ava Smith")).getByText("from Winter Cup")).toBeTruthy();
  });

  it("a game answer set on the page still wins after a refresh", async () => {
    const { rerender } = render(page(event({}), [{ profileId: "mia", status: "available" }]));
    const user = userEvent.setup();
    await user.click(within(yourPicker()).getByRole("button", { name: "Unavailable" }));
    await waitFor(() => expect(groupOf("Mia Chen")).toBe("unavailable"));

    rerender(page(event({}), [{ profileId: "mia", status: "maybe" }]));

    expect(groupOf("Mia Chen")).toBe("unavailable");
    expect(within(rowOf("Mia Chen")).queryByText("from Surf Cup")).toBeNull();
  });
});
