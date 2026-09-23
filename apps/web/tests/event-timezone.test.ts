/**
 * Event-level timezones (BUG-010, decision D5).
 *
 * An event's date and time inputs used to be read in the editing device's zone,
 * and recurring series were expanded in it too. A coach travelling, or a club
 * admin in another city, silently created events at the wrong instant, and a
 * series crossing a daylight-saving change drifted by an hour in any zone that
 * was not the device's.
 *
 * Every conversion here takes the event's zone explicitly. The process zone is
 * pinned to Tokyo — a third zone that is neither the event's nor UTC, and has no
 * daylight saving — so any hidden use of the device zone shows up as a wrong
 * instant instead of passing by coincidence.
 */

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.TZ = "Asia/Tokyo";
});

import {
  wallClockIn,
  instantFromWallClock,
  eventTimeZone,
  timeZoneChoices,
  expandInZone,
} from "@/lib/events/event-timezone";
import { buildRRule, untilEndOfDay } from "@/lib/utils/rrule";

const PACIFIC = "America/Los_Angeles";
const DENVER = "America/Denver";

describe("test environment", () => {
  it("runs in Tokyo, not the event's zone or UTC", () => {
    expect(new Date("2026-09-17T00:00:00.000Z").getTimezoneOffset()).toBe(-540);
  });
});

describe("instantFromWallClock", () => {
  it("reads a wall-clock time in the event's zone, not the device's", () => {
    // 4:00 PM Pacific Daylight Time is 23:00 UTC.
    expect(instantFromWallClock("2026-09-17T16:00", PACIFIC).toISOString()).toBe("2026-09-17T23:00:00.000Z");
    expect(instantFromWallClock("2026-09-17T16:00", DENVER).toISOString()).toBe("2026-09-17T22:00:00.000Z");
  });

  it("uses standard time in winter", () => {
    expect(instantFromWallClock("2026-01-14T16:00", PACIFIC).toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("moves a time that does not exist (spring forward) past the gap", () => {
    // 2:30 AM on March 8, 2026 never happens in Pacific time; it becomes 3:30 AM PDT.
    const instant = instantFromWallClock("2026-03-08T02:30", PACIFIC);
    expect(instant.toISOString()).toBe("2026-03-08T10:30:00.000Z");
    expect(wallClockIn(instant, PACIFIC)).toBe("2026-03-08T03:30");
  });

  it("takes the first of a time that happens twice (fall back)", () => {
    // 1:30 AM on November 1, 2026 happens in PDT and again in PST.
    expect(instantFromWallClock("2026-11-01T01:30", PACIFIC).toISOString()).toBe("2026-11-01T08:30:00.000Z");
  });

  it("round-trips through wallClockIn", () => {
    for (const wall of ["2026-09-17T16:00", "2026-12-31T23:45", "2026-11-01T00:15", "2026-03-08T04:00"]) {
      expect(wallClockIn(instantFromWallClock(wall, DENVER), DENVER)).toBe(wall);
    }
  });
});

describe("wallClockIn", () => {
  it("shows the instant in the event's zone", () => {
    expect(wallClockIn("2026-09-17T23:00:00.000Z", PACIFIC)).toBe("2026-09-17T16:00");
    expect(wallClockIn("2026-09-17T23:00:00.000Z", "UTC")).toBe("2026-09-17T23:00");
  });

  it("writes midnight as 00, not 24", () => {
    expect(wallClockIn("2026-09-18T07:00:00.000Z", PACIFIC)).toBe("2026-09-18T00:00");
  });
});

describe("eventTimeZone", () => {
  it("prefers the event's own zone", () => {
    expect(eventTimeZone({ timezone: DENVER }, PACIFIC, "UTC")).toBe(DENVER);
  });

  it("falls back to the team's zone for events from before event zones", () => {
    expect(eventTimeZone({ timezone: null }, PACIFIC, "UTC")).toBe(PACIFIC);
  });

  it("falls back to the viewer's zone when neither is set", () => {
    expect(eventTimeZone({ timezone: null }, null, "Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("ignores a zone this engine cannot use", () => {
    expect(eventTimeZone({ timezone: "Not/AZone" }, PACIFIC, "UTC")).toBe(PACIFIC);
  });
});

describe("timeZoneChoices", () => {
  it("includes the common zones and whatever is already chosen", () => {
    const choices = timeZoneChoices(["Etc/GMT+5"]);
    expect(choices).toContain(PACIFIC);
    expect(choices).toContain(DENVER);
    expect(choices).toContain("Etc/GMT+5");
    expect(new Set(choices).size).toBe(choices.length);
  });
});

describe("expandInZone — recurring series keep their local clock time (D5)", () => {
  it("keeps a 6 PM Pacific practice at 6 PM across the November daylight-saving change", () => {
    const rule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [0], // Monday
      until: untilEndOfDay("2026-11-16"),
      dtstart: new Date("2026-10-26T18:00:00.000Z"),
    });

    const starts = expandInZone("2026-10-26T18:00", rule, PACIFIC);

    expect(starts.map((d) => d.toISOString())).toEqual([
      "2026-10-27T01:00:00.000Z", // PDT, UTC-7
      "2026-11-03T02:00:00.000Z", // PST, UTC-8
      "2026-11-10T02:00:00.000Z",
      "2026-11-17T02:00:00.000Z", // the end date is included
    ]);
    expect(starts.map((d) => wallClockIn(d, PACIFIC).slice(11))).toEqual(["18:00", "18:00", "18:00", "18:00"]);
  });

  it("lands each occurrence on its local day even when that is the next day in UTC", () => {
    const rule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [0], // Monday
      until: untilEndOfDay("2026-09-14"),
      dtstart: new Date("2026-09-07T18:00:00.000Z"),
    });

    const starts = expandInZone("2026-09-07T18:00", rule, PACIFIC);

    expect(starts.map((d) => wallClockIn(d, PACIFIC))).toEqual(["2026-09-07T18:00", "2026-09-14T18:00"]);
  });
});
