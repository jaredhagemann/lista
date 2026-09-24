/**
 * Event times on the phone are shown in the event's own zone (BUG-010, D5).
 *
 * The schedule, event and home screens formatted every time in the phone's
 * zone with no label, so a parent travelling — or just in another zone from the
 * team — saw the wrong clock time for practice. The event screen's "Arrive by"
 * also formatted the arrival offset (a number of minutes) as if it were a time.
 *
 * The process zone is pinned to Tokyo (jest.config.js), a zone no event here is in.
 */

import {
  eventZone,
  formatEventDay,
  formatEventClock,
  formatEventDateTime,
  arrivalInstant,
} from "../lib/event-time";

const DENVER = "America/Denver";
// 4:00–5:30 PM Mountain Daylight Time on Thursday, Sept 17, 2026.
const START = "2026-09-17T22:00:00+00:00";
const END = "2026-09-17T23:30:00+00:00";

describe("test environment", () => {
  it("runs in Tokyo", () => {
    expect(new Date(START).getTimezoneOffset()).toBe(-540);
  });
});

describe("eventZone", () => {
  it("prefers the event's own zone, then the team's", () => {
    expect(eventZone({ timezone: DENVER, teams: { timezone: "America/Los_Angeles" } })).toBe(DENVER);
    expect(eventZone({ timezone: null, teams: { timezone: "America/Los_Angeles" } })).toBe("America/Los_Angeles");
  });

  it("is undefined — the phone's own zone — when neither is set or usable", () => {
    expect(eventZone({ timezone: null, teams: null })).toBeUndefined();
    expect(eventZone({ timezone: "Not/AZone", teams: { timezone: null } })).toBeUndefined();
  });
});

describe("formatting in the event's zone, labeled", () => {
  it("shows the local clock time with the zone", () => {
    expect(formatEventClock(START, DENVER)).toBe("4:00 PM MDT");
    expect(formatEventClock(END, DENVER)).toBe("5:30 PM MDT");
  });

  it("shows the event's local day, not the phone's (already Friday in Tokyo)", () => {
    expect(formatEventDay(START, DENVER)).toBe("Thu, Sep 17");
    expect(formatEventDateTime(START, DENVER)).toBe("Thursday, September 17, 2026 at 4:00 PM MDT");
  });

  it("labels the phone's own zone when the event has none", () => {
    expect(formatEventClock(START, undefined)).toBe("7:00 AM GMT+9");
  });
});

describe("arrival time", () => {
  it("is the start minus the arrival offset in minutes", () => {
    expect(formatEventClock(arrivalInstant(START, 30), DENVER)).toBe("3:30 PM MDT");
  });
});
