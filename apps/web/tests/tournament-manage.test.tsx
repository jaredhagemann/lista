// @vitest-environment jsdom
/**
 * Managing tournaments on the web (docs/specs/tournaments-and-leagues.md §4,
 * "Web", "Cancelling and rescheduling", D5, D13, D15, D18; part 2b).
 *
 *   - creating: "Tournament" in the create dialog takes a name, its days and its
 *     games, saved in one call (create_tournament) with one notice
 *   - its page: edit (name, days, location, notes, placement), add a game,
 *     cancel (with its remaining games, or keeping them as standalone games),
 *     restore (the tournament only), and delete with its games
 *   - rescheduling doesn't move games: the form lists any now outside its days
 *   - a game in a tournament is edited with its round, and stays a game
 *   - none of it for someone who isn't a coach or manager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.TZ = "Asia/Tokyo";
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => {
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const updates: { row: Record<string, unknown>; id: unknown }[] = [];
  const inserts: Record<string, unknown>[] = [];
  const navigate = vi.fn();
  const refresh = vi.fn();
  const rpcResult: { error: { message: string } | null } = { error: null };

  const from = (table: string) => {
    const result = () => Promise.resolve({ data: [], error: null, count: 0 });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "order", "in", "gte", "is", "limit"]) chain[m] = () => chain;
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    if (table === "events") {
      chain.update = (row: Record<string, unknown>) => ({
        eq: (_col: string, id: unknown) => {
          updates.push({ row, id });
          return Promise.resolve({ error: null });
        },
      });
      chain.insert = (row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve({ error: null });
      };
    }
    return chain;
  };
  return {
    rpcs,
    updates,
    inserts,
    navigate,
    refresh,
    rpcResult,
    client: {
      from,
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcs.push({ name, args });
        return { data: name === "create_tournament" ? "t-new" : 1, error: rpcResult.error };
      },
      auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }) }));
vi.mock("@/components/layout/navigation-progress", () => ({ useNavigate: () => ({ navigate: mocks.navigate }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notifications/client", () => ({
  drainNotifications: vi.fn(async () => null),
  withNotice: (message: string) => message,
}));

import { toast } from "sonner";
import { drainNotifications } from "@/lib/notifications/client";
import { EventDetail } from "@/components/calendar/event-detail";
import { EventFormDialog } from "@/components/calendar/event-form-dialog";

const LA = "America/Los_Angeles";
const TEAM = { name: "U10 Girls", home_uniform: null, away_uniform: null, home_uniform_color: null, away_uniform_color: null };

function event(overrides: Record<string, unknown>) {
  return {
    id: "evt",
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
    tournament_id: null,
    round: null,
    placement_rank: null,
    placement_label: null,
    tournament: null,
    created_by: null,
    created_at: null,
    ...overrides,
  };
}

// Fri Dec 11 – Sun Dec 13, 2026, Pacific.
const SURF_CUP = event({
  id: "t-1",
  title: "Surf Cup",
  event_type: "tournament",
  start_time: "2026-12-11T08:00:00.000Z",
  end_time: "2026-12-14T08:00:00.000Z",
  opponent: null,
  home_away: null,
});

const GAMES = [
  event({ id: "g-1", tournament_id: "t-1", round: "Pool A", start_time: "2026-12-11T17:00:00.000Z" }),
  event({ id: "g-2", tournament_id: "t-1", round: "Semifinal", opponent: "Eagles", start_time: "2026-12-12T17:00:00.000Z" }),
  event({ id: "g-3", tournament_id: "t-1", round: "Final", opponent: "Hawks", start_time: "2026-12-13T17:00:00.000Z" }),
];

function renderPage(ev: unknown, extra: Record<string, unknown> = {}) {
  return render(
    <EventDetail
      event={ev as never}
      isAdmin
      creatorName="Coach Kim"
      team={TEAM}
      teamTimeZone={LA}
      currentUserId="coach-1"
      availabilityRows={[]}
      members={[{ profileId: "coach-1", name: "Coach Kim", role: "coach" }]}
      {...extra}
    />
  );
}

const rpc = (name: string) => mocks.rpcs.filter((c) => c.name === name);

beforeEach(() => {
  mocks.rpcs.length = 0;
  mocks.updates.length = 0;
  mocks.inserts.length = 0;
  mocks.rpcResult.error = null;
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  // A week before Surf Cup.
  vi.setSystemTime(new Date("2026-12-04T20:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── Creating ──────────────────────────────────────────────────────────────────

async function startTournament() {
  render(<EventFormDialog open onClose={() => {}} teamId="team-1" teamTimeZone={LA} team={TEAM} defaultDate="2026-12-11" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Type" }));
  await user.click(await screen.findByRole("option", { name: "Tournament" }));
  return user;
}

describe("creating a tournament", () => {
  it("asks for its days, not times, and can't be made recurring (D13, D18)", async () => {
    await startTournament();

    expect(screen.getByLabelText("First day")).toBeTruthy();
    expect(screen.getByLabelText("Last day")).toBeTruthy();
    expect(screen.queryByLabelText("Start")).toBeNull();
    expect(screen.queryByRole("switch", { name: /recurring/i })).toBeNull();
  });

  it("saves the tournament and its games in one call, notifying the team", async () => {
    const user = await startTournament();
    await user.type(screen.getByLabelText("Name"), "Surf Cup");
    fireEvent.change(screen.getByLabelText("First day"), { target: { value: "2026-12-11" } });
    fireEvent.change(screen.getByLabelText("Last day"), { target: { value: "2026-12-13" } });

    await user.click(screen.getByRole("button", { name: "Add a game" }));
    fireEvent.change(screen.getByLabelText("Game 1 start"), { target: { value: "2026-12-11T09:00" } });
    fireEvent.change(screen.getByLabelText("Game 1 end"), { target: { value: "2026-12-11T10:30" } });
    await user.type(screen.getByLabelText("Game 1 opponent"), "Rivals FC");
    await user.type(screen.getByLabelText("Game 1 round"), "Pool A");

    await user.click(screen.getByRole("button", { name: "Add a game" }));
    fireEvent.change(screen.getByLabelText("Game 2 start"), { target: { value: "2026-12-13T14:00" } });
    fireEvent.change(screen.getByLabelText("Game 2 end"), { target: { value: "2026-12-13T15:30" } });
    await user.type(screen.getByLabelText("Game 2 round"), "Final");

    await user.click(screen.getByRole("button", { name: "Create tournament" }));

    await waitFor(() => expect(rpc("create_tournament")).toHaveLength(1));
    expect(rpc("create_tournament")[0].args).toEqual({
      p_team_id: "team-1",
      p_title: "Surf Cup",
      p_first_day: "2026-12-11",
      p_last_day: "2026-12-13",
      p_timezone: LA,
      p_location_id: null,
      p_notes: null,
      p_notify: true,
      p_games: [
        {
          title: "U10 Girls vs Rivals FC",
          start_time: "2026-12-11T17:00:00.000Z",
          end_time: "2026-12-11T18:30:00.000Z",
          opponent: "Rivals FC",
          home_away: null,
          uniform: null,
          round: "Pool A",
        },
        {
          title: "Final",
          start_time: "2026-12-13T22:00:00.000Z",
          end_time: "2026-12-13T23:30:00.000Z",
          opponent: null,
          home_away: null,
          uniform: null,
          round: "Final",
        },
      ],
    });
    // No plain inserts: the database writes the tournament and its games together.
    expect(mocks.inserts).toHaveLength(0);
    // The one notice create_tournament queued goes now.
    expect(drainNotifications).toHaveBeenCalled();
  });

  it("leaves the team un-notified when the coach switches it off", async () => {
    const user = await startTournament();
    await user.type(screen.getByLabelText("Name"), "Winter Classic");
    await user.click(screen.getByRole("switch", { name: "Notify the team" }));
    await user.click(screen.getByRole("button", { name: "Create tournament" }));

    await waitFor(() => expect(rpc("create_tournament")).toHaveLength(1));
    expect(rpc("create_tournament")[0].args.p_notify).toBe(false);
    expect(rpc("create_tournament")[0].args.p_games).toEqual([]);
  });

  it("warns about a game outside the tournament's days, and still saves it", async () => {
    const user = await startTournament();
    await user.type(screen.getByLabelText("Name"), "Surf Cup");
    fireEvent.change(screen.getByLabelText("First day"), { target: { value: "2026-12-11" } });
    fireEvent.change(screen.getByLabelText("Last day"), { target: { value: "2026-12-13" } });
    await user.click(screen.getByRole("button", { name: "Add a game" }));
    fireEvent.change(screen.getByLabelText("Game 1 start"), { target: { value: "2026-12-14T09:00" } });
    fireEvent.change(screen.getByLabelText("Game 1 end"), { target: { value: "2026-12-14T10:00" } });

    expect(screen.getByText(/outside the tournament's days/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Create tournament" }));
    await waitFor(() => expect(rpc("create_tournament")).toHaveLength(1));
  });

  it("refuses a last day before the first, without calling the database", async () => {
    const user = await startTournament();
    await user.type(screen.getByLabelText("Name"), "Surf Cup");
    fireEvent.change(screen.getByLabelText("First day"), { target: { value: "2026-12-13" } });
    fireEvent.change(screen.getByLabelText("Last day"), { target: { value: "2026-12-11" } });
    await user.click(screen.getByRole("button", { name: "Create tournament" }));

    expect(screen.getByText("The last day can't be before the first.")).toBeTruthy();
    expect(rpc("create_tournament")).toHaveLength(0);
  });

  it("a removed game isn't saved", async () => {
    const user = await startTournament();
    await user.type(screen.getByLabelText("Name"), "Surf Cup");
    await user.click(screen.getByRole("button", { name: "Add a game" }));
    await user.click(screen.getByRole("button", { name: "Remove game 1" }));
    await user.click(screen.getByRole("button", { name: "Create tournament" }));

    await waitFor(() => expect(rpc("create_tournament")).toHaveLength(1));
    expect(rpc("create_tournament")[0].args.p_games).toEqual([]);
  });
});

// ── Its page ──────────────────────────────────────────────────────────────────

describe("a tournament's page, for a coach", () => {
  it("offers its own edit, add-a-game, cancel and delete actions", () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES });

    expect(screen.getByRole("button", { name: "Edit tournament" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete tournament" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a game" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel this tournament" })).toBeTruthy();
    // Never the single-event controls, which would act on the tournament alone.
    expect(screen.queryByRole("button", { name: "Edit event" })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel this event/i })).toBeNull();
  });

  it("offers none of it to someone who isn't a coach or manager", () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES, isAdmin: false });

    expect(screen.queryByRole("button", { name: "Edit tournament" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete tournament" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a game" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel this tournament" })).toBeNull();
  });
});

describe("cancelling a tournament (D15)", () => {
  it("cancels it with its remaining games", async () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel this tournament" }));
    await user.click(screen.getByRole("button", { name: "Cancel it and its 3 remaining games" }));

    await waitFor(() => expect(rpc("cancel_tournament")).toHaveLength(1));
    expect(rpc("cancel_tournament")[0].args).toEqual({ p_tournament_id: "t-1", p_cancel_games: true });
    expect(drainNotifications).toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("or cancels only the tournament, keeping its games as standalone games", async () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel this tournament" }));
    expect(screen.getByText(/stay on the schedule as standalone games/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel the tournament only" }));

    await waitFor(() => expect(rpc("cancel_tournament")).toHaveLength(1));
    expect(rpc("cancel_tournament")[0].args).toEqual({ p_tournament_id: "t-1", p_cancel_games: false });
  });

  it("counts only upcoming games that aren't cancelled", async () => {
    // Saturday evening: Friday's and Saturday's games are played.
    vi.setSystemTime(new Date("2026-12-13T03:00:00.000Z"));
    renderPage(SURF_CUP, { tournamentGames: GAMES });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel this tournament" }));

    expect(screen.getByRole("button", { name: "Cancel it and its remaining game" })).toBeTruthy();
    expect(screen.getByText(/played games keep their results/i)).toBeTruthy();
  });

  it("with no upcoming games, there's nothing to choose", async () => {
    renderPage(SURF_CUP, { tournamentGames: [] });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel this tournament" }));
    expect(screen.queryByRole("button", { name: "Cancel the tournament only" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel tournament" }));

    await waitFor(() => expect(rpc("cancel_tournament")).toHaveLength(1));
    expect(rpc("cancel_tournament")[0].args).toEqual({ p_tournament_id: "t-1", p_cancel_games: true });
  });

  it("says why when the database refuses", async () => {
    mocks.rpcResult.error = { message: "ALREADY_CANCELLED" };
    renderPage(SURF_CUP, { tournamentGames: GAMES });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel this tournament" }));
    await user.click(screen.getByRole("button", { name: "Cancel the tournament only" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This tournament is already cancelled."));
  });
});

describe("restoring a tournament (D15)", () => {
  it("restores the tournament only, and says its games stay as they are", async () => {
    renderPage({ ...SURF_CUP, is_cancelled: true }, { tournamentGames: GAMES.map((g) => ({ ...g, is_cancelled: true })) });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Restore this tournament" }));
    expect(screen.getByText(/games cancelled with it stay cancelled/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(mocks.updates).toHaveLength(1));
    expect(mocks.updates[0]).toEqual({ row: { is_cancelled: false }, id: "t-1" });
    expect(drainNotifications).toHaveBeenCalled();
  });

  it("a cancelled tournament offers restore, not edit or add a game", () => {
    renderPage({ ...SURF_CUP, is_cancelled: true }, { tournamentGames: GAMES });

    expect(screen.queryByRole("button", { name: "Edit tournament" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a game" })).toBeNull();
    // Deleting it stays possible.
    expect(screen.getByRole("button", { name: "Delete tournament" })).toBeTruthy();
  });
});

describe("deleting a tournament (D5)", () => {
  it("deletes it with its games, in one call, after saying how many", async () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete tournament" }));
    expect(screen.getByText(/everyone's answers.*can't be undone/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete the tournament and its 3 games" }));

    await waitFor(() => expect(rpc("delete_tournament")).toHaveLength(1));
    expect(rpc("delete_tournament")[0].args).toEqual({ p_tournament_id: "t-1" });
    expect(drainNotifications).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/dashboard/schedule");
  });

  it("a tournament without games is simply deleted", async () => {
    renderPage(SURF_CUP, { tournamentGames: [] });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete tournament" }));
    await user.click(screen.getByRole("button", { name: "Delete the tournament" }));

    await waitFor(() => expect(rpc("delete_tournament")).toHaveLength(1));
  });
});

describe("editing a tournament", () => {
  async function openEditor(ev: unknown = SURF_CUP, games = GAMES) {
    renderPage(ev, { tournamentGames: games });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit tournament" }));
    return user;
  }

  it("starts from its name and days, in its zone", async () => {
    await openEditor();

    expect(screen.getByLabelText("Name")).toHaveProperty("value", "Surf Cup");
    expect(screen.getByLabelText("First day")).toHaveProperty("value", "2026-12-11");
    expect(screen.getByLabelText("Last day")).toHaveProperty("value", "2026-12-13");
  });

  it("saves new days as whole days in its zone, without moving its games", async () => {
    const user = await openEditor();
    fireEvent.change(screen.getByLabelText("Last day"), { target: { value: "2026-12-14" } });
    await user.click(screen.getByRole("button", { name: "Save tournament" }));

    await waitFor(() => expect(mocks.updates).toHaveLength(1));
    const { row, id } = mocks.updates[0];
    expect(id).toBe("t-1");
    expect(row).toMatchObject({
      title: "Surf Cup",
      start_time: "2026-12-11T08:00:00.000Z",
      end_time: "2026-12-15T08:00:00.000Z",
      timezone: LA,
    });
    // A tournament's row only: rescheduling it never touches its games.
    expect(mocks.updates.every((u) => u.id === "t-1")).toBe(true);
    expect(row).not.toHaveProperty("event_type");
  });

  it("lists the games the new days leave outside, so the coach can move them", async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText("First day"), { target: { value: "2026-12-12" } });
    fireEvent.change(screen.getByLabelText("Last day"), { target: { value: "2026-12-12" } });

    const warning = screen.getByRole("status", { name: "Games outside the tournament's days" });
    expect(within(warning).getByText(/Pool A/)).toBeTruthy();
    expect(within(warning).getByText(/Final/)).toBeTruthy();
    expect(within(warning).queryByText(/Semifinal/)).toBeNull();
  });

  it("sets and clears the placement", async () => {
    const user = await openEditor();
    await user.type(screen.getByLabelText("Place"), "2");
    await user.type(screen.getByLabelText("Placement label"), "Silver bracket champions");
    await user.click(screen.getByRole("button", { name: "Save tournament" }));

    await waitFor(() => expect(mocks.updates).toHaveLength(1));
    expect(mocks.updates[0].row).toMatchObject({ placement_rank: 2, placement_label: "Silver bracket champions" });

    cleanup();
    mocks.updates.length = 0;
    const user2 = await openEditor({ ...SURF_CUP, placement_rank: 2, placement_label: "Silver" });
    await user2.clear(screen.getByLabelText("Place"));
    await user2.clear(screen.getByLabelText("Placement label"));
    await user2.click(screen.getByRole("button", { name: "Save tournament" }));

    await waitFor(() => expect(mocks.updates).toHaveLength(1));
    expect(mocks.updates[0].row).toMatchObject({ placement_rank: null, placement_label: null });
  });

  it("a placement can be entered after the tournament is over", async () => {
    vi.setSystemTime(new Date("2026-12-20T12:00:00.000Z"));
    const user = await openEditor();
    await user.type(screen.getByLabelText("Place"), "1");
    await user.click(screen.getByRole("button", { name: "Save tournament" }));

    await waitFor(() => expect(mocks.updates[0].row).toMatchObject({ placement_rank: 1 }));
  });

  it("refuses a last day before the first", async () => {
    const user = await openEditor();
    fireEvent.change(screen.getByLabelText("Last day"), { target: { value: "2026-12-10" } });
    await user.click(screen.getByRole("button", { name: "Save tournament" }));

    expect(screen.getByText("The last day can't be before the first.")).toBeTruthy();
    expect(mocks.updates).toHaveLength(0);
  });
});

describe("adding a game to a tournament", () => {
  it("saves a game in the tournament, in its zone, with its round, and tells the team", async () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add a game" }));
    fireEvent.change(screen.getByLabelText("Game 1 start"), { target: { value: "2026-12-13T16:00" } });
    fireEvent.change(screen.getByLabelText("Game 1 end"), { target: { value: "2026-12-13T17:00" } });
    await user.type(screen.getByLabelText("Game 1 opponent"), "Sharks");
    await user.type(screen.getByLabelText("Game 1 round"), "Third place");
    await user.click(screen.getByRole("button", { name: "Add game" }));

    await waitFor(() => expect(mocks.inserts).toHaveLength(1));
    expect(mocks.inserts[0]).toMatchObject({
      team_id: "team-1",
      tournament_id: "t-1",
      event_type: "game",
      title: "U10 Girls vs Sharks",
      start_time: "2026-12-14T00:00:00.000Z",
      end_time: "2026-12-14T01:00:00.000Z",
      timezone: LA,
      opponent: "Sharks",
      round: "Third place",
    });
    const id = mocks.inserts[0].id;
    expect(rpc("enqueue_event_notification")).toEqual([
      { name: "enqueue_event_notification", args: { p_event_id: id, p_action: "created" } },
    ]);
    expect(drainNotifications).toHaveBeenCalled();
  });

  it("warns about a game outside the tournament's days", async () => {
    renderPage(SURF_CUP, { tournamentGames: GAMES });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add a game" }));
    fireEvent.change(screen.getByLabelText("Game 1 start"), { target: { value: "2026-12-15T09:00" } });

    expect(screen.getByText(/outside the tournament's days/i)).toBeTruthy();
  });
});

// ── A game in a tournament ────────────────────────────────────────────────────

describe("editing a game in a tournament", () => {
  const semifinal = {
    ...GAMES[1],
    tournament: {
      id: "t-1",
      title: "Surf Cup",
      start_time: SURF_CUP.start_time,
      end_time: SURF_CUP.end_time,
      timezone: LA,
    },
  };

  it("edits its round, and keeps it a game", async () => {
    renderPage(semifinal, { initialEdit: true });
    const user = userEvent.setup();

    // Changing its type would take it out of the tournament, which the database refuses.
    expect(screen.queryByRole("combobox", { name: "Type" })).toBeNull();
    const round = screen.getByLabelText("Round");
    expect(round).toHaveProperty("value", "Semifinal");
    await user.clear(round);
    await user.type(round, "Quarterfinal");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(mocks.updates).toHaveLength(1));
    expect(mocks.updates[0].row).toMatchObject({ event_type: "game", round: "Quarterfinal" });
  });

  it("warns when it's moved outside the tournament's days", async () => {
    renderPage(semifinal, { initialEdit: true });
    expect(screen.queryByText(/outside the tournament's days/i)).toBeNull();

    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-12-15T09:00" } });
    expect(screen.getByText(/outside Surf Cup's days/i)).toBeTruthy();
  });

  it("a standalone game has no round", () => {
    renderPage(event({ id: "solo" }), { initialEdit: true });

    expect(screen.queryByLabelText("Round")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Type" })).toBeTruthy();
  });
});
