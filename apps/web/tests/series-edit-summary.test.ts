/**
 * What a series edit tells the team (PR #96 review, P2).
 *
 * Moving a series to another day cancels the old occurrences and adds new ones,
 * so no single row's before/after says what happened: the notice said
 * "Cancelled: … — 3 events". The editor already shows the coach what changed
 * before they confirm; seriesEditSummary is that summary as text, sent with the
 * edit so the one notice for it can list Recurrence, Time, Time zone and fields.
 */

import { describe, it, expect } from "vitest";
import { RRule } from "rrule";
import { seriesEditSummary } from "@/lib/events/series-summary";
import type { SeriesEditPlan } from "@/lib/events/series-edit";

const PACIFIC = "America/Los_Angeles";
const DENVER = "America/Denver";

// Tuesdays 4:00–5:30 PM Pacific.
const ANCHOR = {
  start_time: "2026-09-29T23:00:00Z",
  end_time: "2026-09-30T00:30:00Z",
  location_id: "islay",
  arrival_time: 15,
};

const weekly = (day: number) =>
  new RRule({ freq: RRule.WEEKLY, byweekday: [day], dtstart: new Date("2026-09-29T16:00:00Z") }).toString();

function plan(overrides: Partial<SeriesEditPlan>): SeriesEditPlan {
  return {
    seriesHeadId: "head",
    newHeadId: "head",
    newHeadRule: weekly(RRule.TU.weekday),
    truncateRule: null,
    updates: [],
    cancels: [],
    inserts: [],
    reparent: [],
    preview: { updated: [], cancelled: [], added: [], unchanged: [] },
    ...overrides,
  };
}

const describe_ = (key: string, value: unknown) =>
  key === "location_id" ? ({ islay: "Islay Park", sinsheimer: "Sinsheimer Park" } as Record<string, string>)[String(value)] : String(value);

function summary(args: Partial<Parameters<typeof seriesEditSummary>[0]>) {
  return seriesEditSummary({
    plan: plan({}),
    fields: {},
    anchor: ANCHOR,
    describe: describe_,
    seriesZone: PACIFIC,
    oldRule: weekly(RRule.TU.weekday),
    patternChanged: false,
    ...args,
  });
}

describe("seriesEditSummary", () => {
  it("a move to another day reads as the recurrence, before and after", () => {
    const newRule = weekly(RRule.WE.weekday);
    const rows = summary({
      plan: plan({
        newHeadRule: newRule,
        cancels: ["tue-1", "tue-2"],
        inserts: [{ id: "wed-1", start_time: "2026-09-30T23:00:00Z", end_time: "2026-10-01T00:30:00Z", fields: {} }],
      }),
      patternChanged: true,
    });

    expect(rows).toEqual([
      {
        field: "Recurrence",
        before: "Every week on Tuesday",
        after: "Every week on Wednesday",
      },
    ]);
    expect(rows[0].before).not.toBe(rows[0].after);
  });

  it("a new time reads as times of day, with the zone", () => {
    const rows = summary({
      plan: plan({ updates: [{ id: "tue-1", start_time: "2026-09-30T00:00:00Z", end_time: "2026-09-30T01:30:00Z", fields: {} }] }),
    });

    expect(rows).toEqual([{ field: "Time", before: "4:00 PM – 5:30 PM PDT", after: "5:00 PM – 6:30 PM PDT" }]);
  });

  it("a new zone shows both, and the time in each", () => {
    const rows = summary({
      newZone: DENVER,
      plan: plan({ updates: [{ id: "tue-1", start_time: "2026-09-29T22:00:00Z", end_time: "2026-09-29T23:30:00Z", fields: {} }] }),
    });

    expect(rows).toEqual([
      { field: "Time", before: "4:00 PM – 5:30 PM PDT", after: "4:00 PM – 5:30 PM MDT" },
      { field: "Time zone", before: "America/Los Angeles (PDT)", after: "America/Denver (MDT)" },
    ]);
  });

  it("changed fields by their labels and as people see them", () => {
    const rows = summary({ fields: { location_id: "sinsheimer", arrival_time: 30 } });

    expect(rows).toEqual([
      { field: "Location", before: "Islay Park", after: "Sinsheimer Park" },
      { field: "Arrival time", before: "15", after: "30" },
    ]);
  });
});
