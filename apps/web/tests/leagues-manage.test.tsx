// @vitest-environment jsdom
/**
 * Managing leagues, and tagging games, on the web (docs/specs/tournaments-and-
 * leagues.md §5; D4, D17, D20, D21; leagues part 2a).
 *
 *   - team settings: a coach lists, adds, renames, archives, restores and
 *     deletes the team's leagues; the database's refusals read as sentences
 *   - "League games": a league's games in a date range, played ones included,
 *     ticked to set or clear their league, silently
 *   - the game forms offer the team's active leagues, plus "Add league…": a new
 *     game (one or a series), an edited game, and a tournament's games
 *   - the old free-text team field reads as display text (D17)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.TZ = "America/Los_Angeles";
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

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {};
  const writes: { op: "insert" | "update" | "delete"; table: string; row?: Row | Row[]; filters: Record<string, unknown> }[] = [];
  const rpcs: { name: string; args: Row }[] = [];
  /** The next write to this table fails with this error. */
  const failNext: Record<string, { code?: string; message: string } | undefined> = {};
  /** Reads of this table fail with this error, until cleared (TL-025). */
  const failReads: Record<string, { message: string } | undefined> = {};

  const from = (table: string) => {
    const eqs: Record<string, unknown> = {};
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "update" | "delete" = "select";
    let payload: Row | undefined;
    const at = (v: unknown) => Date.parse(String(v));
    const finish = () => {
      if (op !== "select") {
        writes.push({ op, table, row: payload, filters: { ...eqs } });
        const error = failNext[table];
        failNext[table] = undefined;
        if (error) return Promise.resolve({ data: null, error });
        // An update changes the stored rows its filters match, and returns them,
        // as PostgREST does with .select(): what really changed (TL-023).
        const matched = op === "update" ? (tables[table] ?? []).filter((r) => filters.every((f) => f(r))) : [];
        for (const r of matched) Object.assign(r, payload);
        return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null });
      }
      if (failReads[table]) return Promise.resolve({ data: null, error: failReads[table] });
      // Copies, as a real read is: later changes to stored rows don't reach it.
      const data = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }));
      return Promise.resolve({ data, error: null });
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      not: () => chain,
      or: () => chain,
      eq: (c: string, v: unknown) => {
        eqs[c] = v;
        filters.push((r) => !(c in r) || r[c] === v);
        return chain;
      },
      in: (c: string, v: unknown[]) => {
        eqs[c] = v;
        filters.push((r) => !(c in r) || v.includes(r[c]));
        return chain;
      },
      gte: (c: string, v: unknown) => {
        filters.push((r) => !(c in r) || at(r[c]) >= at(v));
        return chain;
      },
      lt: (c: string, v: unknown) => {
        filters.push((r) => !(c in r) || at(r[c]) < at(v));
        return chain;
      },
      insert: (row: Row | Row[]) => {
        writes.push({ op: "insert", table, row, filters: {} });
        const error = failNext[table];
        failNext[table] = undefined;
        const done = Promise.resolve({ data: null, error: error ?? null });
        return Object.assign(done, {
          select: () => ({ single: () => Promise.resolve({ data: { id: "head-1", ...(Array.isArray(row) ? row[0] : row) }, error: null }) }),
        });
      },
      update: (row: Row) => {
        op = "update";
        payload = row;
        return chain;
      },
      delete: () => {
        op = "delete";
        return chain;
      },
      single: () => finish().then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
      maybeSingle: () => finish().then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => finish().then(res, rej),
    };
    return chain;
  };
  return {
    tables,
    writes,
    rpcs,
    failNext,
    failReads,
    client: {
      from,
      rpc: async (name: string, args: Row) => {
        rpcs.push({ name, args });
        return { data: "t-new", error: null };
      },
      auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) },
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/layout/navigation-progress", () => ({ useNavigate: () => ({ navigate: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notifications/client", () => ({
  drainNotifications: vi.fn(async () => null),
  withNotice: (message: string) => message,
}));

import { toast } from "sonner";
import { drainNotifications } from "@/lib/notifications/client";
import { LeaguesSection } from "@/components/leagues/leagues-section";
import { EventFormDialog } from "@/components/calendar/event-form-dialog";
import { EventEditForm } from "@/components/calendar/event-detail";

const LA = "America/Los_Angeles";
const TEAM = { name: "U10 Girls", home_uniform: null, away_uniform: null, home_uniform_color: null, away_uniform_color: null };

const DIV3 = { id: "l-1", team_id: "team-1", name: "Division 3", season: "Fall 2026", archived_at: null, created_at: "2026-09-01T00:00:00Z", created_by: null };
const REC = { id: "l-2", team_id: "team-1", name: "Rec", season: "Spring 2027", archived_at: null, created_at: "2026-09-02T00:00:00Z", created_by: null };
const OLD = { id: "l-3", team_id: "team-1", name: "Division 4", season: "Fall 2025", archived_at: "2026-01-01T00:00:00Z", created_at: "2025-09-01T00:00:00Z", created_by: null };

const writesTo = (table: string) => mocks.writes.filter((w) => w.table === table);
const user = userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.writes.length = 0;
  mocks.rpcs.length = 0;
  for (const key of Object.keys(mocks.failNext)) delete mocks.failNext[key];
  for (const key of Object.keys(mocks.failReads)) delete mocks.failReads[key];
  vi.clearAllMocks();
  // Copies: updates change stored rows now (TL-023), and a test mustn't leak into the next.
  mocks.tables.leagues = [DIV3, REC, OLD].map((l) => ({ ...l }));
  mocks.tables.teams = [{ id: "team-1", season: "Fall 2026" }];
  mocks.tables.locations = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T19:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── Team settings ─────────────────────────────────────────────────────────────

describe("the Leagues section", () => {
  const renderSection = () => render(<LeaguesSection teamId="team-1" teamName="U10 Girls" defaultSeason="Fall 2026" />);

  it("lists active leagues, and archived ones apart", async () => {
    renderSection();

    const active = await screen.findByRole("list", { name: "Active leagues" });
    expect(within(active).getByText("Division 3")).toBeTruthy();
    expect(within(active).getByText("Rec")).toBeTruthy();
    const archived = screen.getByRole("list", { name: "Archived leagues" });
    expect(within(archived).getByText("Division 4")).toBeTruthy();
  });

  it("adds a league, tidying its spaces (D21), with the team's season to start", async () => {
    renderSection();
    await screen.findByRole("list", { name: "Active leagues" });

    expect(screen.getByLabelText("Season")).toHaveProperty("value", "Fall 2026");
    await user.type(screen.getByLabelText("League name"), "  Premier   Division ");
    await user.click(screen.getByRole("button", { name: "Add league" }));

    await waitFor(() => expect(writesTo("leagues")).toHaveLength(1));
    expect(writesTo("leagues")[0]).toMatchObject({
      op: "insert",
      row: { team_id: "team-1", name: "Premier Division", season: "Fall 2026" },
    });
  });

  it("says so when a league with that name and season exists (D21)", async () => {
    renderSection();
    await screen.findByRole("list", { name: "Active leagues" });
    mocks.failNext.leagues = { code: "23505", message: "duplicate key" };

    await user.type(screen.getByLabelText("League name"), "Division 3");
    await user.click(screen.getByRole("button", { name: "Add league" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("There's already a league with that name and season."));
  });

  it("renames a league", async () => {
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Edit Division 3" }));
    const dialog = screen.getByRole("dialog");
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Division 2");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(writesTo("leagues")).toEqual([
        { op: "update", table: "leagues", row: { name: "Division 2", season: "Fall 2026" }, filters: { id: "l-1" } },
      ])
    );
  });

  it("archives a league, and restores one (D17)", async () => {
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Archive Division 3" }));
    await waitFor(() => expect(writesTo("leagues")[0]).toMatchObject({ op: "update", filters: { id: "l-1" } }));
    expect(typeof (writesTo("leagues")[0].row as Row).archived_at).toBe("string");

    await user.click(screen.getByRole("button", { name: "Restore Division 4" }));
    await waitFor(() => expect(writesTo("leagues")[1]).toEqual({ op: "update", table: "leagues", row: { archived_at: null }, filters: { id: "l-3" } }));
  });

  it("deletes a league after asking, and says why one with games can't be (D20)", async () => {
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Delete Division 3" }));
    mocks.failNext.leagues = { code: "23503", message: "LEAGUE_HAS_GAMES: this league has games; archive it instead" };
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete league" }));

    await waitFor(() => expect(writesTo("leagues")[0]).toMatchObject({ op: "delete", filters: { id: "l-1" } }));
    expect(toast.error).toHaveBeenCalledWith(
      "This league has games, so it can't be deleted. Archive it instead: that keeps its record."
    );
  });
});

// ── League games ──────────────────────────────────────────────────────────────

describe("League games", () => {
  const GAMES = [
    { id: "g-past", team_id: "team-1", event_type: "game", title: "Game", opponent: "Rivals FC", home_away: "home", start_time: "2026-09-12T17:00:00Z", timezone: LA, league_id: null, score_for: 3, score_against: 1 },
    { id: "g-tagged", team_id: "team-1", event_type: "game", title: "Game", opponent: "Eagles", home_away: "away", start_time: "2026-10-17T17:00:00Z", timezone: LA, league_id: "l-1", score_for: null, score_against: null },
    { id: "g-rec", team_id: "team-1", event_type: "game", title: "Game", opponent: "Hawks", home_away: "home", start_time: "2026-10-24T17:00:00Z", timezone: LA, league_id: "l-2", score_for: null, score_against: null },
  ];

  async function open(games: Row[] = GAMES) {
    mocks.tables.events = games.map((g) => ({ ...g }));
    render(<LeaguesSection teamId="team-1" teamName="U10 Girls" defaultSeason="Fall 2026" />);
    await user.click(await screen.findByRole("button", { name: "League games for Division 3" }));
    return screen.getByRole("dialog");
  }

  it("lists the team's games in the range, played ones included, ticked when in this league", async () => {
    const dialog = await open();

    const past = await within(dialog).findByRole("checkbox", { name: /U10 Girls vs Rivals FC · 3–1/ });
    expect((past as HTMLInputElement).checked).toBe(false);
    expect((within(dialog).getByRole("checkbox", { name: /U10 Girls @ Eagles/ }) as HTMLInputElement).checked).toBe(true);
    // A game in another league says so; ticking it moves it here.
    expect(within(dialog).getByText("In Spring 2027 Rec")).toBeTruthy();
  });

  it("sets and clears the league on the games changed, and sends nothing", async () => {
    const dialog = await open();
    await user.click(await within(dialog).findByRole("checkbox", { name: /Rivals FC/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Eagles/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Hawks/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writesTo("events")).toHaveLength(2));
    expect(writesTo("events")).toEqual(
      expect.arrayContaining([
        { op: "update", table: "events", row: { league_id: "l-1" }, filters: { id: ["g-past", "g-rec"] } },
        { op: "update", table: "events", row: { league_id: null }, filters: { id: ["g-tagged"], league_id: "l-1" } },
      ])
    );
    // Classification, not schedule news.
    expect(drainNotifications).not.toHaveBeenCalled();
  });

  // ── Review findings on PR #125 (docs/reviews/2026-10-01-tournaments-and-leagues-review.md) ──

  it("TL-023: unticking a game someone has since moved to another league leaves it there", async () => {
    const dialog = await open();
    await within(dialog).findByRole("checkbox", { name: /Eagles/ });
    // Meanwhile, another coach moves it to Rec.
    mocks.tables.events.find((g) => g.id === "g-tagged")!.league_id = "l-2";

    await user.click(within(dialog).getByRole("checkbox", { name: /Eagles/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writesTo("events")).toHaveLength(1));
    expect(mocks.tables.events.find((g) => g.id === "g-tagged")!.league_id).toBe("l-2");
    expect(toast.info).toHaveBeenCalledWith("1 game had moved to another league since you opened this, so it was left there.");
  });

  it("TL-023: a game still in this league is untagged as before", async () => {
    const dialog = await open();
    await user.click(await within(dialog).findByRole("checkbox", { name: /Eagles/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.tables.events.find((g) => g.id === "g-tagged")!.league_id).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Updated 1 game");
  });

  describe("TL-024: the dates are each game's own date, as shown", () => {
    const NY = "America/New_York";
    // A game well outside the narrowed dates: once it's gone, the list shown is
    // the narrowed one, not the first, broad read still on screen.
    const FAR = { ...GAMES[0], id: "g-far", opponent: "Faraway", start_time: "2026-12-05T17:00:00Z", timezone: LA };
    const narrowed = async (dialog: HTMLElement, expected: RegExp) =>
      waitFor(() => {
        expect(within(dialog).queryByRole("checkbox", { name: /Faraway/ })).toBeNull();
        expect(within(dialog).getByRole("checkbox", { name: expected })).toBeTruthy();
      });
    const setRange = (dialog: HTMLElement, from: string, to: string) => {
      fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: from } });
      fireEvent.change(within(dialog).getByLabelText("To"), { target: { value: to } });
    };

    it("a New York game just after midnight is on its own day, from a Pacific browser", async () => {
      // Sat Oct 17, 12:30 AM EDT: Fri Oct 16 in the browser's Los Angeles.
      const dialog = await open([
        { ...GAMES[0], id: "g-ny", opponent: "Knicks", start_time: "2026-10-17T04:30:00Z", timezone: NY },
        FAR,
      ]);
      await within(dialog).findByRole("checkbox", { name: /Faraway/ });
      setRange(dialog, "2026-10-17", "2026-10-17");

      await narrowed(dialog, /Knicks.* · Sat, Oct 17/);
    });

    it("the last hour of a fall-back day is still that day", async () => {
      // Sun Nov 1, 11:30 PM PST: the 25-hour day clocks fall back on.
      const dialog = await open([
        { ...GAMES[0], id: "g-late", opponent: "Owls", start_time: "2026-11-02T07:30:00Z", timezone: LA },
        FAR,
      ]);
      await within(dialog).findByRole("checkbox", { name: /Faraway/ });
      setRange(dialog, "2026-11-01", "2026-11-01");

      await narrowed(dialog, /Owls.* · Sun, Nov 1/);
    });

    it("a game just past the last day is left out", async () => {
      const dialog = await open([
        { ...GAMES[0], id: "g-next", opponent: "Bears", start_time: "2026-10-18T04:30:00Z", timezone: NY },
        { ...GAMES[0], id: "g-in", opponent: "Lions", start_time: "2026-10-17T17:00:00Z", timezone: NY },
      ]);
      setRange(dialog, "2026-10-17", "2026-10-17");

      expect(await within(dialog).findByRole("checkbox", { name: /Lions/ })).toBeTruthy();
      expect(within(dialog).queryByRole("checkbox", { name: /Bears/ })).toBeNull();
    });

    it("says the dates are each game's own", async () => {
      const dialog = await open();

      expect(within(dialog).getByText(/each game's own date/i)).toBeTruthy();
    });
  });

  describe("TL-025: ticks belong to the dates they were read for", () => {
    it("a failed read for new dates offers nothing to save, and a retry reads them", async () => {
      const dialog = await open();
      await user.click(await within(dialog).findByRole("checkbox", { name: /Rivals FC/ }));

      mocks.failReads.events = { message: "statement timeout" };
      fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: "2026-10-18" } });

      expect(await within(dialog).findByText(/Couldn't load the games/)).toBeTruthy();
      expect(within(dialog).queryByRole("checkbox", { name: /Rivals FC/ })).toBeNull();
      expect((within(dialog).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

      mocks.failReads.events = undefined;
      await user.click(within(dialog).getByRole("button", { name: "Try again" }));
      // From Oct 18: the Oct 24 game, not the Sep 12 one ticked before.
      expect(await within(dialog).findByRole("checkbox", { name: /Hawks/ })).toBeTruthy();
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      // Nothing ticked under the old dates is written.
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("No changes"));
      expect(writesTo("events")).toEqual([]);
    });

    it("can't save while new dates are loading", async () => {
      const dialog = await open();
      await within(dialog).findByRole("checkbox", { name: /Rivals FC/ });

      fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: "2026-10-18" } });

      expect((within(dialog).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("a From date after To says so, and can't be saved", async () => {
      const dialog = await open();
      await within(dialog).findByRole("checkbox", { name: /Rivals FC/ });

      fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: "2027-01-10" } });
      fireEvent.change(within(dialog).getByLabelText("To"), { target: { value: "2027-01-01" } });

      expect(within(dialog).getByText("The From date is after the To date.")).toBeTruthy();
      expect((within(dialog).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    });
  });
});

// ── The game forms ────────────────────────────────────────────────────────────

describe("a new game's league", () => {
  async function startGame() {
    render(<EventFormDialog open onClose={() => {}} teamId="team-1" teamTimeZone={LA} team={TEAM} defaultDate="2026-10-17" />);
    await user.type(screen.getByLabelText("Title"), "League game");
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Game" }));
  }

  it("offers the team's active leagues, not archived ones", async () => {
    await startGame();

    const picker = (await screen.findByLabelText("League")) as HTMLSelectElement;
    const options = [...picker.options].map((o) => o.textContent);
    expect(options).toEqual(["No league", "Fall 2026 Division 3", "Spring 2027 Rec", "+ Add league…"]);
  });

  it("saves the game with its league", async () => {
    await startGame();
    fireEvent.change(await screen.findByLabelText("League"), { target: { value: "l-1" } });
    await user.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(writesTo("events")).toHaveLength(1));
    expect(writesTo("events")[0].row).toMatchObject({ event_type: "game", league_id: "l-1" });
  });

  it("a series of games carries it on every occurrence", async () => {
    await startGame();
    fireEvent.change(await screen.findByLabelText("League"), { target: { value: "l-2" } });
    await user.click(screen.getByRole("switch", { name: /recurring event/i }));
    fireEvent.change(await screen.findByLabelText("Repeat until"), { target: { value: "2026-10-31" } });
    await user.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(writesTo("events")).toHaveLength(2));
    const [head, children] = writesTo("events").map((w) => w.row);
    expect(head).toMatchObject({ league_id: "l-2" });
    expect((children as Row[]).every((c) => c.league_id === "l-2")).toBe(true);
  });

  it("adds a league from the picker, and picks it", async () => {
    await startGame();
    fireEvent.change(await screen.findByLabelText("League"), { target: { value: "__new__" } });
    await user.type(screen.getByLabelText("New league name"), "Cup  League");
    await user.click(screen.getByRole("button", { name: "Add this league" }));

    await waitFor(() => expect(writesTo("leagues")).toHaveLength(1));
    const created = writesTo("leagues")[0].row as Row;
    expect(created).toMatchObject({ team_id: "team-1", name: "Cup League", season: "Fall 2026" });
    expect((screen.getByLabelText("League") as HTMLSelectElement).value).toBe(created.id);
  });

  it("a practice has no league", async () => {
    render(<EventFormDialog open onClose={() => {}} teamId="team-1" teamTimeZone={LA} team={TEAM} defaultDate="2026-10-17" />);

    expect(screen.queryByLabelText("League")).toBeNull();
  });
});

describe("an edited game's league", () => {
  const GAME = {
    id: "g-1",
    team_id: "team-1",
    title: "Game",
    event_type: "game",
    start_time: "2026-10-17T17:00:00.000Z",
    end_time: "2026-10-17T18:30:00.000Z",
    timezone: LA,
    location_id: null,
    notes: null,
    opponent: "Rivals FC",
    home_away: "home",
    uniform: null,
    game_result: null,
    score_for: null,
    score_against: null,
    arrival_time: null,
    recurrence_rule: null,
    parent_event_id: null,
    tournament_id: null,
    league_id: "l-1",
    round: null,
    placement_rank: null,
    placement_label: null,
    is_cancelled: false,
    created_by: null,
    created_at: null,
  };

  it("starts from its league and saves a change", async () => {
    render(
      <EventEditForm editingEvent={GAME as never} teamId="team-1" timeZone={LA} team={TEAM} onSave={() => {}} onCancel={() => {}} />
    );
    const picker = (await screen.findByLabelText("League")) as HTMLSelectElement;
    await waitFor(() => expect(picker.value).toBe("l-1"));

    fireEvent.change(picker, { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(writesTo("events")).toHaveLength(1));
    expect(writesTo("events")[0].row).toMatchObject({ league_id: null });
  });

  it("an archived league it's in still shows, so saving keeps it", async () => {
    render(
      <EventEditForm
        editingEvent={{ ...GAME, league_id: "l-3" } as never}
        teamId="team-1"
        timeZone={LA}
        team={TEAM}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    const picker = (await screen.findByLabelText("League")) as HTMLSelectElement;
    await waitFor(() => expect(picker.value).toBe("l-3"));
    expect([...picker.options].map((o) => o.textContent)).toContain("Fall 2025 Division 4 (archived)");
  });
});

describe("a tournament's games' leagues (D4)", () => {
  it("each game can be given a league when the tournament is created", async () => {
    render(<EventFormDialog open onClose={() => {}} teamId="team-1" teamTimeZone={LA} team={TEAM} defaultDate="2026-12-11" />);
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Tournament" }));
    await user.type(screen.getByLabelText("Name"), "Surf Cup");
    await user.click(screen.getByRole("button", { name: "Add a game" }));
    await user.click(screen.getByRole("button", { name: "Add a game" }));
    fireEvent.change(await screen.findByLabelText("Game 1 league"), { target: { value: "l-1" } });
    await user.click(screen.getByRole("button", { name: "Create tournament" }));

    await waitFor(() => expect(mocks.rpcs).toHaveLength(1));
    const games = mocks.rpcs[0].args.p_games as Row[];
    expect(games.map((g) => g.league_id)).toEqual(["l-1", null]);
  });
});

// ── The old team field ────────────────────────────────────────────────────────

describe("the team's own league field (D17)", () => {
  it("reads as display text, not a league", async () => {
    const { TeamSettingsForm } = await import("@/components/settings/team-settings-form");
    render(<TeamSettingsForm team={{ id: "team-1", name: "U10 Girls", league: "AYSO Region 42" } as never} isAdmin />);

    expect(screen.getByText("League (shown on your team page)")).toBeTruthy();
  });
});
