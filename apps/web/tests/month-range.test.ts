/**
 * Calendar month boundaries in the team's timezone (BUG-014, spec §5).
 *
 * The grid asks "which events belong to December?", and the answer depends on a
 * zone: December starts at local midnight, which is a different UTC instant in
 * Los Angeles than in Berlin. Two rules follow from the spec:
 *
 *   - derive the next boundary as a local calendar boundary, never by adding a
 *     fixed number of hours, which lands an hour out across a DST change
 *   - use half-open ranges, so an event exactly at midnight belongs to the month
 *     that is starting and not to the one that just ended
 *
 * The same zone groups events into days, so the grid cannot place an event in a
 * cell the query did not fetch.
 */

import { describe, it, expect } from "vitest";
import {
  monthKeyOf,
  monthRange,
  addMonths,
  dayKeyOf,
  daysInMonth,
  firstWeekdayOf,
  monthLabelOf,
} from "@/lib/events/month-range";

const PACIFIC = "America/Los_Angeles";
const BERLIN = "Europe/Berlin";

describe("month boundaries", () => {
  it("starts and ends at local midnight, as UTC instants", () => {
    // December 2026 in Pacific standard time is UTC-8.
    expect(monthRange("2026-12", PACIFIC)).toEqual({
      fromInclusive: "2026-12-01T08:00:00.000Z",
      toExclusive: "2027-01-01T08:00:00.000Z",
    });

    // Berlin is UTC+1 that month.
    expect(monthRange("2026-12", BERLIN)).toEqual({
      fromInclusive: "2026-11-30T23:00:00.000Z",
      toExclusive: "2026-12-31T23:00:00.000Z",
    });
  });

  it("crosses a spring-forward month without drifting an hour", () => {
    // Pacific loses an hour on 8 March 2026: March is 743 hours, not 744.
    const march = monthRange("2026-03", PACIFIC);

    expect(march).toEqual({
      fromInclusive: "2026-03-01T08:00:00.000Z",
      toExclusive: "2026-04-01T07:00:00.000Z",
    });
    const hours =
      (Date.parse(march.toExclusive) - Date.parse(march.fromInclusive)) / 3_600_000;
    expect(hours).toBe(743);
  });

  it("crosses a fall-back month the same way", () => {
    // Pacific gains an hour on 1 November 2026: November is 721 hours.
    const november = monthRange("2026-11", PACIFIC);
    const hours =
      (Date.parse(november.toExclusive) - Date.parse(november.fromInclusive)) / 3_600_000;

    expect(hours).toBe(721);
  });

  it("is half-open, so a midnight event belongs to one month only", () => {
    const december = monthRange("2026-12", PACIFIC);
    const january = monthRange("2027-01", PACIFIC);

    expect(december.toExclusive).toBe(january.fromInclusive);
    // An event exactly at the shared boundary is January's: `< toExclusive`.
    const boundary = Date.parse(december.toExclusive);
    expect(boundary < Date.parse(december.toExclusive)).toBe(false);
    expect(boundary >= Date.parse(january.fromInclusive)).toBe(true);
  });

  it("falls back to the validated default when the zone is missing or nonsense", () => {
    expect(monthRange("2026-12", undefined)).toEqual({
      fromInclusive: "2026-12-01T00:00:00.000Z",
      toExclusive: "2027-01-01T00:00:00.000Z",
    });
    expect(monthRange("2026-12", "Mars/Olympus_Mons")).toEqual(
      monthRange("2026-12", undefined)
    );
  });
});

describe("naming a month", () => {
  it("names the month an instant falls in, in the grid's zone", () => {
    // 1 January 2027 at 00:30 UTC is still 31 December in Pacific.
    expect(monthKeyOf("2027-01-01T00:30:00.000Z", PACIFIC)).toBe("2026-12");
    expect(monthKeyOf("2027-01-01T00:30:00.000Z", BERLIN)).toBe("2027-01");
  });

  it("steps forward and back across a year boundary", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-12", -12)).toBe("2025-12");
    expect(addMonths("2026-01", 13)).toBe("2027-02");
  });
});

describe("grouping events into days", () => {
  it("uses the grid's zone, not the reader's", () => {
    // 4:00 PM Pacific on 17 September is 23:00 UTC the same day.
    expect(dayKeyOf("2026-09-17T23:00:00.000Z", PACIFIC)).toBe("2026-09-17");
    // The same instant is already the 18th in Berlin.
    expect(dayKeyOf("2026-09-17T23:00:00.000Z", BERLIN)).toBe("2026-09-18");
  });

  it("puts an event on the day the month query would have fetched it for", () => {
    const december = monthRange("2026-12", PACIFIC);
    const firstInstant = december.fromInclusive;

    expect(dayKeyOf(firstInstant, PACIFIC)).toBe("2026-12-01");
    expect(monthKeyOf(firstInstant, PACIFIC)).toBe("2026-12");
  });
});

describe("laying out the grid", () => {
  it("counts the days in a month, leap years included", () => {
    expect(daysInMonth("2026-12")).toBe(31);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-11")).toBe(30);
  });

  it("places the first of the month in the grid's zone, not the reader's", () => {
    // 1 December 2026 is a Tuesday.
    expect(firstWeekdayOf("2026-12", PACIFIC)).toBe(2);
    expect(firstWeekdayOf("2026-12", BERLIN)).toBe(2);
    // 1 November 2026 is a Sunday.
    expect(firstWeekdayOf("2026-11", PACIFIC)).toBe(0);
  });

  it("labels the month it is showing", () => {
    expect(monthLabelOf("2026-12", PACIFIC)).toBe("December 2026");
    expect(monthLabelOf("2027-01", PACIFIC)).toBe("January 2027");
  });
});
