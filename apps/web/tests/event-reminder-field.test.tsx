// @vitest-environment jsdom
/**
 * The event form's Reminder field (docs/specs/team-notification-controls.md §4.1).
 *
 * Team default, Always send, or Don't send, saved on the event. The default
 * says what the team's settings mean for this event type. A reminder setting
 * is lista's behavior, not the schedule, so changing only it tells the team
 * nothing: "Notify the team" is hidden, and the save ignores it (D13).
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

import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => {
  const updates: Record<string, unknown>[] = [];
  /** The ids each events update was limited to with .in("id", …). */
  const updatedIds: unknown[][] = [];
  const inserts: unknown[] = [];
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const state = { teamSettings: null as Record<string, unknown> | null };
  const from = (table: string) => {
    const result = () =>
      Promise.resolve({ data: table === "team_reminder_settings" ? state.teamSettings : [], error: null, count: 0 });
    const chain: Record<string, unknown> = {};
    let updating = false;
    for (const m of ["select", "eq", "or", "order", "gte", "is", "limit"]) chain[m] = () => chain;
    chain.in = (_column: string, values: unknown[]) => {
      if (updating) updatedIds.push(values);
      return chain;
    };
    chain.update = (values: Record<string, unknown>) => {
      if (table === "events") {
        updates.push(values);
        updating = true;
      }
      return chain;
    };
    chain.insert = (rows: unknown) => {
      if (table === "events") inserts.push(rows);
      const head = Array.isArray(rows) ? rows[0] : rows;
      return Object.assign(Promise.resolve({ error: null }), {
        select: () => ({ single: () => Promise.resolve({ data: { id: "head-1", ...(head as object) }, error: null }) }),
      });
    };
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return chain;
  };
  return {
    updates,
    updatedIds,
    inserts,
    rpc,
    state,
    client: {
      from,
      rpc,
      auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) },
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

import { EventEditForm } from "@/components/calendar/event-detail";
import { EventFormDialog } from "@/components/calendar/event-form-dialog";
import { TournamentEditForm } from "@/components/tournaments/tournament-edit-form";
import { SeriesEditForm } from "@/components/calendar/series-edit-form";

const TEAM = { name: "U10 Girls", home_uniform: null, away_uniform: null, home_uniform_color: null, away_uniform_color: null };

const PRACTICE = {
  id: "evt-1",
  team_id: "team-1",
  title: "Practice",
  event_type: "practice",
  start_time: "2026-12-12T17:00:00+00:00",
  end_time: "2026-12-12T18:30:00+00:00",
  timezone: "America/Los_Angeles",
  is_cancelled: false,
  location_id: null,
  locations: null,
  arrival_time: null,
  notes: null,
  opponent: null,
  home_away: null,
  uniform: null,
  game_result: null,
  score_for: null,
  score_against: null,
  recurrence_rule: null,
  parent_event_id: null,
  tournament_id: null,
  league_id: null,
  round: null,
  placement_rank: null,
  placement_label: null,
  reminder: null,
  created_by: "coach-1",
  created_at: null,
};

function renderEdit(overrides: Record<string, unknown> = {}) {
  const onSave = vi.fn();
  render(
    <EventEditForm
      editingEvent={{ ...PRACTICE, ...overrides } as never}
      teamId="team-1"
      timeZone="America/Los_Angeles"
      teamTimeZone="America/Los_Angeles"
      team={TEAM}
      onSave={onSave}
      onCancel={() => {}}
    />
  );
  return onSave;
}

async function chooseReminder(option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Reminder" }));
  await user.click(await screen.findByRole("option", { name: option }));
}

const notifySwitch = () => screen.queryByRole("switch", { name: "Notify the team" });

beforeEach(() => {
  mocks.updates.length = 0;
  mocks.updatedIds.length = 0;
  mocks.inserts.length = 0;
  mocks.state.teamSettings = null;
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("editing an event's reminder", () => {
  it("saves the choice on the event", async () => {
    const onSave = renderEdit();

    await chooseReminder("Don't send");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(mocks.updates[0]).toMatchObject({ reminder: "never" });
  });

  it("goes back to the team default", async () => {
    const onSave = renderEdit({ reminder: "always" });

    await chooseReminder("Team default (on)");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(mocks.updates[0]).toMatchObject({ reminder: null });
  });

  it("says what the team default is for this type", async () => {
    mocks.state.teamSettings = { enabled: true, remind_practice: false, remind_game: true, remind_other: true, remind_tournament: true };
    renderEdit();

    expect(await screen.findByRole("combobox", { name: "Reminder" })).toHaveProperty(
      "textContent",
      "Team default (off)"
    );
  });

  it("hides 'Notify the team' when only the reminder changed, and notifies nobody (D13)", async () => {
    const onSave = renderEdit();
    // Switched on before the reminder was the only change.
    fireEvent.click(notifySwitch()!);

    await chooseReminder("Always send");
    expect(notifySwitch()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(mocks.rpc).not.toHaveBeenCalledWith("enqueue_event_notification", expect.anything());
  });

  it("still notifies when asked, with another change alongside", async () => {
    const onSave = renderEdit();

    await chooseReminder("Always send");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Team practice" } });
    fireEvent.click(notifySwitch()!);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(mocks.rpc).toHaveBeenCalledWith("enqueue_event_notification", { p_event_id: "evt-1", p_action: "updated" });
  });
});

describe("creating an event", () => {
  it("saves its reminder choice", async () => {
    render(<EventFormDialog open onClose={() => {}} teamId="team-1" teamTimeZone="America/Denver" team={{ name: "U10 Girls" }} />);

    await userEvent.type(screen.getByLabelText("Title"), "Practice");
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-12-12T16:00" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-12-12T17:30" } });
    await chooseReminder("Don't send");
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mocks.inserts).toHaveLength(1));
    expect(mocks.inserts[0]).toMatchObject({ reminder: "never" });
  });

  it("defaults to the team default", async () => {
    render(<EventFormDialog open onClose={() => {}} teamId="team-1" teamTimeZone="America/Denver" team={{ name: "U10 Girls" }} />);

    await userEvent.type(screen.getByLabelText("Title"), "Practice");
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-12-12T16:00" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-12-12T17:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mocks.inserts).toHaveLength(1));
    expect(mocks.inserts[0]).toMatchObject({ reminder: null });
  });
});

describe("editing a tournament", () => {
  it("saves its reminder, and changing only that notifies nobody (D13)", async () => {
    const onSave = vi.fn();
    const tournament = {
      ...PRACTICE,
      id: "tour-1",
      title: "Surf Cup",
      event_type: "tournament",
      start_time: "2026-12-12T08:00:00+00:00",
      end_time: "2026-12-14T07:59:00+00:00",
    };
    render(
      <TournamentEditForm
        tournament={tournament as never}
        zone="America/Los_Angeles"
        games={[]}
        teamName="U10 Girls"
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    await chooseReminder("Don't send");
    fireEvent.click(notifySwitch()!);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(mocks.updates[0]).toMatchObject({ reminder: "never" });
    expect(mocks.rpc).not.toHaveBeenCalledWith("enqueue_event_notification", expect.anything());
  });
});

describe("editing a series' reminder (review RR-002)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const base = Date.parse("2026-12-03T16:00:00Z");
  const occurrence = (id: string, start: number, extra: Record<string, unknown> = {}) => ({
    ...PRACTICE,
    id,
    timezone: "UTC",
    start_time: new Date(start).toISOString(),
    end_time: new Date(start + 90 * 60 * 1000).toISOString(),
    parent_event_id: "head",
    ...extra,
  });
  // Weekly Thursdays, Dec 3, 10 and 17; Dec 10 moved to Friday on its own.
  const series = [
    occurrence("head", base, {
      parent_event_id: null,
      recurrence_rule: "DTSTART:20261203T160000Z\nRRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261217T235959Z",
    }),
    occurrence("moved", base + 8 * DAY),
    occurrence("last", base + 14 * DAY),
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("sets every occurrence's reminder, moved ones included, without rebuilding the schedule", async () => {
    const onSave = vi.fn();
    render(
      <SeriesEditForm
        series={series as never}
        openedId="head"
        scope="series"
        teamId="team-1"
        fallbackTimeZone="UTC"
        team={TEAM}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    await chooseReminder("Don't send");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(mocks.updates).toEqual([{ reminder: "never" }]);
    expect(mocks.updatedIds).toEqual([["head", "moved", "last"]]);
    expect(mocks.rpc).not.toHaveBeenCalledWith("apply_series_edit", expect.anything());
  });
});
