import { describe, it, expect } from "vitest";
import {
  buildRRule,
  expandRecurrence,
  expandRecurrenceFromLocalString,
  getRecurrenceDescription,
} from "@/lib/utils/rrule";

describe("buildRRule", () => {
  it("creates a weekly rule for a single day", () => {
    const rrule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [1], // Tuesday in rrule convention (0=Mon)
      until: new Date("2026-04-01T00:00:00Z"),
    });

    expect(rrule).toContain("FREQ=WEEKLY");
    expect(rrule).toContain("INTERVAL=1");
    expect(rrule).toContain("BYDAY=TU");
  });

  it("creates a biweekly rule", () => {
    const rrule = buildRRule({
      frequency: "biweekly",
      daysOfWeek: [0], // Monday in rrule convention
      until: new Date("2026-06-01T00:00:00Z"),
    });

    expect(rrule).toContain("FREQ=WEEKLY");
    expect(rrule).toContain("INTERVAL=2");
    expect(rrule).toContain("BYDAY=MO");
  });

  it("handles Sunday (6 in rrule convention)", () => {
    const rrule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [6], // Sunday in rrule convention
      until: new Date("2026-04-01T00:00:00Z"),
    });

    expect(rrule).toContain("BYDAY=SU");
  });
});

describe("expandRecurrence", () => {
  it("generates weekly occurrences starting from the given start time", () => {
    // Tuesday March 3, 2026 at 6:00 PM UTC
    const startTime = new Date("2026-03-03T18:00:00Z");

    const rrule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [1], // Tuesday (rrule: 0=Mon, 1=Tue)
      until: new Date("2026-03-31T23:59:59Z"),
    });

    const occurrences = expandRecurrence(rrule, startTime);

    // Should include every Tuesday from March 3 through March 31
    expect(occurrences.length).toBeGreaterThanOrEqual(4); // Mar 3, 10, 17, 24, possibly 31
    expect(occurrences.length).toBeLessThanOrEqual(5);

    // First occurrence should match start time
    expect(occurrences[0].getUTCDay()).toBe(2); // JS Tuesday = 2

    // All occurrences should be on Tuesday
    for (const occ of occurrences) {
      expect(occ.getUTCDay()).toBe(2);
    }

    // All occurrences should preserve the time of day (18:00 UTC)
    for (const occ of occurrences) {
      expect(occ.getUTCHours()).toBe(18);
      expect(occ.getUTCMinutes()).toBe(0);
    }

    // Occurrences should be 7 days apart
    for (let i = 1; i < occurrences.length; i++) {
      const diffDays =
        (occurrences[i].getTime() - occurrences[i - 1].getTime()) /
        (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(7);
    }
  });

  it("generates biweekly occurrences 14 days apart", () => {
    // Monday March 2, 2026 at 5:00 PM UTC
    const startTime = new Date("2026-03-02T17:00:00Z");

    const rrule = buildRRule({
      frequency: "biweekly",
      daysOfWeek: [0], // Monday (rrule: 0=Mon)
      until: new Date("2026-04-30T23:59:59Z"),
    });

    const occurrences = expandRecurrence(rrule, startTime);

    // March 2 through April 30 biweekly: Mar 2, Mar 16, Mar 30, Apr 13, Apr 27
    expect(occurrences.length).toBeGreaterThanOrEqual(4);

    // All occurrences should be on Monday
    for (const occ of occurrences) {
      expect(occ.getUTCDay()).toBe(1); // JS Monday = 1
    }

    // Occurrences should be 14 days apart
    for (let i = 1; i < occurrences.length; i++) {
      const diffDays =
        (occurrences[i].getTime() - occurrences[i - 1].getTime()) /
        (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(14);
    }
  });

  it("filters occurrences within a date range", () => {
    const startTime = new Date("2026-03-03T18:00:00Z");

    const rrule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [1], // Tuesday
      until: new Date("2026-04-30T23:59:59Z"),
    });

    const rangeStart = new Date("2026-03-15T00:00:00Z");
    const rangeEnd = new Date("2026-03-31T23:59:59Z");

    const occurrences = expandRecurrence(rrule, startTime, rangeStart, rangeEnd);

    // Should only include Tuesdays between Mar 15 and Mar 31: Mar 17, 24, 31
    for (const occ of occurrences) {
      expect(occ.getTime()).toBeGreaterThanOrEqual(rangeStart.getTime());
      expect(occ.getTime()).toBeLessThanOrEqual(rangeEnd.getTime());
    }
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty array when start time is after until date", () => {
    const startTime = new Date("2026-05-01T18:00:00Z");

    const rrule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [1],
      until: new Date("2026-04-01T00:00:00Z"),
    });

    const occurrences = expandRecurrence(rrule, startTime);
    expect(occurrences).toHaveLength(0);
  });
});

describe("expandRecurrence day-of-week mapping", () => {
  // This tests the conversion used in event-form-dialog.tsx:
  // daysOfWeek: [startDate.getDay() === 0 ? 6 : startDate.getDay() - 1]
  // JS: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
  // rrule: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6

  function jsToRRuleDay(jsDay: number): number {
    return jsDay === 0 ? 6 : jsDay - 1;
  }

  const testCases = [
    { jsDay: 0, rruleDay: 6, name: "Sunday", expectedJsDay: 0 },
    { jsDay: 1, rruleDay: 0, name: "Monday", expectedJsDay: 1 },
    { jsDay: 2, rruleDay: 1, name: "Tuesday", expectedJsDay: 2 },
    { jsDay: 3, rruleDay: 2, name: "Wednesday", expectedJsDay: 3 },
    { jsDay: 4, rruleDay: 3, name: "Thursday", expectedJsDay: 4 },
    { jsDay: 5, rruleDay: 4, name: "Friday", expectedJsDay: 5 },
    { jsDay: 6, rruleDay: 5, name: "Saturday", expectedJsDay: 6 },
  ];

  for (const { jsDay, rruleDay, name, expectedJsDay } of testCases) {
    it(`maps JS ${name} (${jsDay}) to rrule day ${rruleDay} and produces correct occurrences`, () => {
      expect(jsToRRuleDay(jsDay)).toBe(rruleDay);

      // Find a date that falls on this day of week in March 2026
      const baseDate = new Date("2026-03-01T18:00:00Z");
      while (baseDate.getUTCDay() !== jsDay) {
        baseDate.setUTCDate(baseDate.getUTCDate() + 1);
      }

      const rrule = buildRRule({
        frequency: "weekly",
        daysOfWeek: [rruleDay],
        until: new Date("2026-04-30T23:59:59Z"),
      });

      const occurrences = expandRecurrence(rrule, baseDate);

      expect(occurrences.length).toBeGreaterThan(0);
      for (const occ of occurrences) {
        expect(occ.getUTCDay()).toBe(expectedJsDay);
      }
    });
  }
});

describe("expandRecurrenceFromLocalString - timezone safety", () => {
  // Helpers that simulate wallClockToTimestamp for specific UTC offsets.
  // getTimezoneOffset() convention: positive = behind UTC (e.g. PST = +480).
  // Formula: realUTC = wallClockUTC + offsetMinutes * 60_000
  const makeConverter = (offsetMinutes: number) => (d: Date) =>
    new Date(d.getTime() + offsetMinutes * 60_000);

  const toPST = makeConverter(480); // UTC-8
  const toEST = makeConverter(300); // UTC-5

  // Helper: derive the rrule daysOfWeek from a datetime-local string the same
  // way event-form-dialog.tsx does.
  function rruleDayFromLocalString(startTimeLocal: string): number {
    const jsDay = new Date(startTimeLocal + ":00.000Z").getUTCDay();
    return jsDay === 0 ? 6 : jsDay - 1;
  }

  it("does not skip the first occurrence for a 4 PM Wednesday event in PST (the bug)", () => {
    // This was the reported bug: 4 PM PST = midnight UTC Thursday, so rrule with the
    // old code saw Thursday as dtstart but Wednesday as byweekday, skipped to next Wed.
    const startTimeLocal = "2026-02-25T16:00"; // Wednesday Feb 25
    const rruleDay = rruleDayFromLocalString(startTimeLocal);

    const rrule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [rruleDay],
      until: new Date("2026-04-30T23:59:59Z"),
    });

    const occurrences = expandRecurrenceFromLocalString(startTimeLocal, rrule, toPST);

    expect(occurrences.length).toBeGreaterThan(0);

    // First occurrence must be Feb 25 4 PM PST = Feb 26 00:00 UTC — not skipped to Mar 4.
    const first = occurrences[0];
    expect(first.getUTCFullYear()).toBe(2026);
    expect(first.getUTCMonth()).toBe(1); // February (0-indexed)
    expect(first.getUTCDate()).toBe(26); // midnight UTC = Feb 25 PST + 8h
    expect(first.getUTCHours()).toBe(0);
    expect(first.getUTCMinutes()).toBe(0);
  });

  it("places all occurrences on the correct local day for a 4 PM PST event", () => {
    const startTimeLocal = "2026-02-25T16:00"; // Wednesday
    const rruleDay = rruleDayFromLocalString(startTimeLocal);
    const PST_OFFSET_MS = 480 * 60_000;

    const rrule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [rruleDay],
      until: new Date("2026-04-30T23:59:59Z"),
    });

    const occurrences = expandRecurrenceFromLocalString(startTimeLocal, rrule, toPST);

    for (const occ of occurrences) {
      // Shift back to "local PST" by subtracting the offset from the real UTC timestamp.
      const localDate = new Date(occ.getTime() - PST_OFFSET_MS);
      expect(localDate.getUTCDay()).toBe(3); // Wednesday in PST perspective
      expect(localDate.getUTCHours()).toBe(16); // 4 PM
      expect(localDate.getUTCMinutes()).toBe(0);
    }
  });

  it("occurrences are exactly 7 days apart for a 4 PM PST weekly event", () => {
    const startTimeLocal = "2026-02-25T16:00";
    const rruleDay = rruleDayFromLocalString(startTimeLocal);

    const rrule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [rruleDay],
      until: new Date("2026-04-30T23:59:59Z"),
    });

    const occurrences = expandRecurrenceFromLocalString(startTimeLocal, rrule, toPST);

    expect(occurrences.length).toBeGreaterThan(1);
    for (let i = 1; i < occurrences.length; i++) {
      const diffDays =
        (occurrences[i].getTime() - occurrences[i - 1].getTime()) /
        (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(7);
    }
  });

  it("works correctly for a noon PST event (same-day UTC, sanity check)", () => {
    // Noon PST = 8 PM UTC — still the same calendar day, so the old code also worked.
    // Verify the new code produces the same correct results.
    const startTimeLocal = "2026-02-25T12:00"; // Wednesday noon PST = 20:00 UTC
    const rruleDay = rruleDayFromLocalString(startTimeLocal);

    const rrule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [rruleDay],
      until: new Date("2026-04-30T23:59:59Z"),
    });

    const occurrences = expandRecurrenceFromLocalString(startTimeLocal, rrule, toPST);

    expect(occurrences.length).toBeGreaterThan(0);
    // Noon PST = 20:00 UTC, still Wednesday UTC — verify UTC representation directly.
    for (const occ of occurrences) {
      expect(occ.getUTCDay()).toBe(3); // Wednesday UTC
      expect(occ.getUTCHours()).toBe(20); // 8 PM UTC
      expect(occ.getUTCMinutes()).toBe(0);
    }
  });

  it("handles a 11 PM PST event (extreme case — crosses midnight UTC to next day)", () => {
    // 11 PM PST = 7 AM UTC next day. The UTC date is a Thursday, but local day is Wednesday.
    const startTimeLocal = "2026-02-25T23:00"; // Wednesday 11 PM PST
    const PST_OFFSET_MS = 480 * 60_000;
    const rruleDay = rruleDayFromLocalString(startTimeLocal);

    const rrule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [rruleDay],
      until: new Date("2026-04-30T23:59:59Z"),
    });

    const occurrences = expandRecurrenceFromLocalString(startTimeLocal, rrule, toPST);

    expect(occurrences.length).toBeGreaterThan(0);
    for (const occ of occurrences) {
      // Real UTC: 7 AM Thursday (next day after the local Wednesday)
      expect(occ.getUTCDay()).toBe(4); // Thursday UTC
      expect(occ.getUTCHours()).toBe(7); // 7 AM UTC

      // But in local PST it should be Wednesday 11 PM
      const localDate = new Date(occ.getTime() - PST_OFFSET_MS);
      expect(localDate.getUTCDay()).toBe(3); // Wednesday local
      expect(localDate.getUTCHours()).toBe(23); // 11 PM
    }
  });

  it("works correctly for a 4 PM EST event (same-day UTC, different offset)", () => {
    // 4 PM EST (UTC-5) = 9 PM UTC — still the same calendar day.
    const startTimeLocal = "2026-02-25T16:00"; // Wednesday 4 PM EST = 21:00 UTC
    const rruleDay = rruleDayFromLocalString(startTimeLocal);

    const rrule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [rruleDay],
      until: new Date("2026-04-30T23:59:59Z"),
    });

    const occurrences = expandRecurrenceFromLocalString(startTimeLocal, rrule, toEST);

    expect(occurrences.length).toBeGreaterThan(0);
    for (const occ of occurrences) {
      expect(occ.getUTCDay()).toBe(3); // Wednesday UTC (9 PM still same day)
      expect(occ.getUTCHours()).toBe(21); // 9 PM UTC
    }
  });

  it("first occurrence timestamp matches what the parent event would store", () => {
    // The parent event is stored as new Date(startTime).toISOString() — the real UTC
    // timestamp for the local time. The first rrule occurrence must equal that value
    // so that slice(1) correctly skips only the parent, not a valid child.
    //
    // Both sides parse the local datetime string through the system timezone, so this
    // assertion holds regardless of what timezone the test machine is in.
    const startTimeLocal = "2026-03-04T18:00"; // Wednesday 6 PM local time

    const rruleDay = rruleDayFromLocalString(startTimeLocal);
    const rrule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [rruleDay],
      until: new Date("2026-04-30T23:59:59Z"),
    });

    const occurrences = expandRecurrenceFromLocalString(startTimeLocal, rrule);

    // event-form-dialog stores: new Date(startTime).toISOString()
    // expandRecurrenceFromLocalString default converter: new Date(y, m, d, h, min)
    // Both interpret wall-clock components in the system local timezone — they must agree.
    const parentStart = new Date(startTimeLocal).toISOString();
    expect(occurrences[0].toISOString()).toBe(parentStart);
  });
});

describe("getRecurrenceDescription", () => {
  it("returns human-readable text for a weekly rule", () => {
    const rrule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [1], // Tuesday
      until: new Date("2026-04-01T00:00:00Z"),
    });

    const desc = getRecurrenceDescription(rrule);
    expect(desc.toLowerCase()).toContain("week");
  });

  it("returns fallback for invalid rrule string", () => {
    const desc = getRecurrenceDescription("not a valid rrule");
    expect(desc).toBe("Recurring event");
  });
});
