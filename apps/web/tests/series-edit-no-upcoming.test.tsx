// @vitest-environment jsdom
/**
 * BUG-034: editing a series with no upcoming events doesn't crash the page
 * (docs/bugs/fixed/034-series-edit-crashes-with-no-upcoming-events.md).
 *
 * A bulk edit only ever changes upcoming events. With none in its scope, it is
 * refused at the scope choice, with the planner's message, and the form doesn't
 * open; "This event" stays available (decided 2026-10-15). The form itself
 * never throws while rendering.
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

import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? [], error: null, count: 0 });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "order", "in", "gte", "is", "limit"]) chain[m] = () => chain;
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return chain;
  };
  return {
    tables,
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

import { toast } from "sonner";
import { EventDetail } from "@/components/calendar/event-detail";
import { SeriesEditForm } from "@/components/calendar/series-edit-form";

const NO_UPCOMING = "There are no upcoming events in this series to change.";
const TEAM = { name: "U10 Girls", home_uniform: null, away_uniform: null, home_uniform_color: null, away_uniform_color: null };
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

function practice(id: string, days: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    team_id: "team-1",
    title: "Practice",
    event_type: "practice",
    start_time: at(days),
    end_time: new Date(Date.parse(at(days)) + 90 * 60 * 1000).toISOString(),
    timezone: "UTC",
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
    parent_event_id: "head",
    tournament_id: null,
    league_id: null,
    round: null,
    placement_rank: null,
    placement_label: null,
    created_by: "coach-1",
    created_at: null,
    ...extra,
  };
}

/** A weekly series starting `firstDay` days from now, `count` occurrences long. */
function weekly(firstDay: number, count: number) {
  const start = new Date(Date.parse(at(firstDay)));
  const dtstart = start.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const rule = `DTSTART:${dtstart}\nRRULE:FREQ=WEEKLY;COUNT=${count}`;
  return Array.from({ length: count }, (_, i) =>
    i === 0
      ? practice("head", firstDay, { recurrence_rule: rule, parent_event_id: null })
      : practice(`occ-${i}`, firstDay + 7 * i)
  );
}

function renderDetail(event: Record<string, unknown>) {
  return render(
    <EventDetail
      event={event as never}
      isAdmin
      creatorName="Coach Casey"
      team={TEAM}
      teamTimeZone="UTC"
      currentUserId="coach-1"
      availabilityRows={[]}
      members={[]}
    />
  );
}

async function choose(option: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: "Edit event" }));
  fireEvent.click(await screen.findByRole("button", { name: option }));
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
});

afterEach(cleanup);

describe("BUG-034: a bulk edit with no upcoming events", () => {
  it("Entire series is refused with the message, and the form doesn't open", async () => {
    const series = weekly(-30, 3);
    mocks.tables.events = series;
    renderDetail(series[2]);

    await choose(/Entire series/);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NO_UPCOMING));
    expect(screen.queryByText("Edit entire series")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit event" })).toBeTruthy();
  });

  it("This and following, the same", async () => {
    const series = weekly(-30, 3);
    mocks.tables.events = series;
    renderDetail(series[1]);

    await choose(/This and following/);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NO_UPCOMING));
    expect(screen.queryByText("Edit this and following events")).toBeNull();
  });

  it("with an upcoming event, Entire series still opens the form", async () => {
    const series = weekly(-10, 3);
    mocks.tables.events = series;
    renderDetail(series[0]);

    await choose(/Entire series/);

    expect(await screen.findByText("Edit entire series")).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("This event still opens the single-event form for a past event", async () => {
    const series = weekly(-30, 3);
    mocks.tables.events = series;
    renderDetail(series[2]);

    await choose(/^This event/);

    expect(await screen.findByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("the form itself, given a series with nothing upcoming, says so instead of throwing", () => {
    const onCancel = vi.fn();
    const series = weekly(-30, 3);
    render(
      <SeriesEditForm
        series={series as never}
        openedId="occ-2"
        scope="series"
        teamId="team-1"
        fallbackTimeZone="UTC"
        team={TEAM}
        onSave={() => {}}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText(NO_UPCOMING)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
