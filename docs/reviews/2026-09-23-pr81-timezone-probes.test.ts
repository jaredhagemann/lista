/**
 * Planning a recurring-series edit (BUG-009, decision D4).
 *
 * The old editor deleted every occurrence and re-inserted it with a fresh id, so
 * availability, results and cancellations were lost and past events rewritten.
 * planSeriesEdit works out, without touching the database, which occurrences an
 * edit updates in place, cancels, adds, or leaves alone. The database applies
 * the plan atomically.
 *
 * Times are wall-clock times on the editing device. The process timezone is
 * pinned to Pacific so series cross the Nov 1 2026 daylight-saving change.
 */

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.TZ = "America/Los_Angeles";
});

import { RRule } from "rrule";
import { planSeriesEdit, pinnedStartRule, SeriesEditError } from "@/lib/events/series-edit";
import { instantFromWallClock, wallClockIn } from "@/lib/events/event-timezone";
import type { Database } from "@/types/database";

type EventRow = Database["public"]["Tables"]["events"]["Row"];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const THURSDAY = 3; // rrule weekday convention: 0 = Monday
const PACIFIC = "America/Los_Angeles";
const DENVER = "America/Denver";
const NOW = new Date("2026-09-17T12:00"); // Thursday noon, before the 4 PM practice

/** "2026-09-17" + "16:00" → the local instant as ISO. */
function at(date: string, time = "16:00") {
  return new Date(`${date}T${time}`).toISOString();
}

function localTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function localDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weeklyThursdays(from: string, until: string): string[] {
  const dates: string[] = [];
  for (let d = new Date(`${from}T12:00`); localDate(d.toISOString()) <= until; d.setDate(d.getDate() + 7)) {
    dates.push(localDate(d.toISOString()));
  }
  return dates;
}

/**
 * A weekly Thursday 4:00–5:30 PM practice series. Ids are "occ-YYYY-MM-DD".
 * `legacy` rules have no DTSTART, like rules created before this fix.
 */
function practiceSeries(
  opts: { from?: string; until?: string; legacy?: boolean; zone?: string } = {}
): EventRow[] {
  const from = opts.from ?? "2026-09-03";
  const zone = opts.zone ?? PACIFIC;
  const start = (date: string, time = "16:00") => instantFromWallClock(`${date}T${time}`, zone).toISOString();
  const until = opts.until ?? "2026-10-29";
  const rule = new RRule({
    freq: RRule.WEEKLY,
    interval: 1,
    byweekday: [THURSDAY],
    until: new Date(`${until}T23:59:59Z`),
    ...(opts.legacy ? {} : { dtstart: new Date(`${from}T16:00:00Z`) }),
  }).toString();

  return weeklyThursdays(from, until).map((date, i) => ({
    id: `occ-${date}`,
    team_id: "team-1",
    title: "Practice",
    notes: null,
    event_type: "practice",
    start_time: start(date),
    end_time: start(date, "17:30"),
    timezone: zone,
    recurrence_rule: i === 0 ? rule : null,
    parent_event_id: i === 0 ? null : `occ-${from}`,
    is_cancelled: false,
    created_by: "coach-1",
    created_at: at(from, "09:00"),
    location_id: "loc-old",
    opponent: null,
    home_away: null,
    uniform: null,
    game_result: null,
    score_for: null,
    score_against: null,
    arrival_time: 15,
  }));
}

function with_(rows: EventRow[], id: string, patch: Partial<EventRow>) {
  return rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

let seq = 0;
const newId = () => `new-${++seq}`;

function plan(args: Partial<Parameters<typeof planSeriesEdit>[0]> & { occurrences: EventRow[] }) {
  seq = 0;
  return planSeriesEdit({
    openedId: "occ-2026-09-17",
    scope: "series",
    now: NOW,
    fields: {},
    timeZone: PACIFIC,
    newId,
    ...args,
  });
}

const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PR81 review probes", () => {
  it("keeps all regular siblings editable when opened from a timezone exception", () => {
    const rows = with_(practiceSeries({ zone: DENVER }), "occ-2026-09-24", {
      timezone: PACIFIC,
      start_time: instantFromWallClock("2026-09-24T16:00", PACIFIC).toISOString(),
      end_time: instantFromWallClock("2026-09-24T17:30", PACIFIC).toISOString(),
    });
    const result = plan({ occurrences: rows, openedId: "occ-2026-09-24", timeZone: PACIFIC, fields: { title: "Updated" } });
    expect(result.updates.map(r => r.id)).toContain("occ-2026-09-17");
  });
  it("moves Auckland spring gap forward", () => {
    expect(wallClockIn("2026-09-26T14:30:00Z", "Pacific/Auckland")).toBe("2026-09-27T03:30");
    expect(instantFromWallClock("2026-09-27T02:30", "Pacific/Auckland").toISOString()).toBe("2026-09-26T14:30:00.000Z");
  });
  it("chooses earlier Auckland fall overlap", () => {
    expect(wallClockIn("2026-04-04T13:30:00Z", "Pacific/Auckland")).toBe("2026-04-05T02:30");
    expect(wallClockIn("2026-04-04T14:30:00Z", "Pacific/Auckland")).toBe("2026-04-05T02:30");
    expect(instantFromWallClock("2026-04-05T02:30", "Pacific/Auckland").toISOString()).toBe("2026-04-04T13:30:00.000Z");
  });
});
