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
import { planSeriesEdit, pinnedStartRule, seriesTimeZone, SeriesEditError } from "@/lib/events/series-edit";
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

describe("test environment", () => {
  it("runs in Pacific time", () => {
    expect(new Date(at("2026-09-17")).getTimezoneOffset()).toBe(420);
  });
});

describe("scope (BUG-009, D4)", () => {
  it("Entire series updates every upcoming occurrence in place and never touches past ones", () => {
    const p = plan({ occurrences: practiceSeries(), fields: { location_id: "loc-new" } });

    expect(ids(p.updates)).toEqual(weeklyThursdays("2026-09-17", "2026-10-29").map((d) => `occ-${d}`));
    expect(p.updates.every((u) => u.fields.location_id === "loc-new")).toBe(true);
    const touched = [...ids(p.updates), ...p.reparent, ...p.cancels];
    expect(touched).not.toContain("occ-2026-09-03");
    expect(touched).not.toContain("occ-2026-09-10");
    expect(p.inserts).toHaveLength(0);
    expect(p.cancels).toHaveLength(0);
  });

  it("splits the series: past occurrences stay in the old series, upcoming ones move under a new head", () => {
    const p = plan({ occurrences: practiceSeries(), fields: { location_id: "loc-new" } });

    expect(p.seriesHeadId).toBe("occ-2026-09-03");
    expect(p.newHeadId).toBe("occ-2026-09-17");
    expect(p.reparent).toEqual(weeklyThursdays("2026-09-24", "2026-10-29").map((d) => `occ-${d}`));

    // The old series now ends before Sept 17 but still covers Sept 3 and 10.
    const truncated = RRule.fromString(p.truncateRule!);
    expect(truncated.origOptions.until!.toISOString()).toBe("2026-09-16T23:59:00.000Z");
    expect(truncated.origOptions.dtstart!.toISOString()).toBe("2026-09-03T16:00:00.000Z");
  });

  it("This and following starts at the opened occurrence and leaves earlier upcoming ones alone", () => {
    const p = plan({
      occurrences: practiceSeries(),
      openedId: "occ-2026-10-08",
      scope: "following",
      fields: { notes: "Bring cones" },
    });

    expect(ids(p.updates)).toEqual(["occ-2026-10-08", "occ-2026-10-15", "occ-2026-10-22", "occ-2026-10-29"]);
    expect(p.newHeadId).toBe("occ-2026-10-08");
    expect(RRule.fromString(p.truncateRule!).origOptions.until!.toISOString()).toBe("2026-10-07T23:59:00.000Z");
  });

  it("This and following from a past occurrence starts at the next upcoming one", () => {
    const p = plan({
      occurrences: practiceSeries(),
      openedId: "occ-2026-09-10",
      scope: "following",
      fields: { notes: "x" },
    });

    expect(p.updates[0].id).toBe("occ-2026-09-17");
  });

  it("does not split when the series head is itself upcoming", () => {
    const p = plan({
      occurrences: practiceSeries({ from: "2026-09-17" }),
      fields: { title: "Team practice" },
    });

    expect(p.newHeadId).toBe("occ-2026-09-17");
    expect(p.truncateRule).toBeNull();
  });

  it("edits the series the opened occurrence belongs to after an earlier split", () => {
    // After a split, Sept 3–10 keep the old head and Sept 17 onward hang off Sept 17.
    const rows = practiceSeries().map((r) => {
      if (r.id === "occ-2026-09-17") {
        return { ...r, parent_event_id: null, recurrence_rule: practiceSeries({ from: "2026-09-17" })[0].recurrence_rule };
      }
      if (r.start_time >= at("2026-09-24")) return { ...r, parent_event_id: "occ-2026-09-17" };
      return r;
    });

    const p = plan({ occurrences: rows, openedId: "occ-2026-10-08", fields: { notes: "x" } });

    expect(p.seriesHeadId).toBe("occ-2026-09-17");
    expect(ids(p.updates)).toEqual(weeklyThursdays("2026-09-17", "2026-10-29").map((d) => `occ-${d}`));
    expect(p.truncateRule).toBeNull();
  });

  it("refuses when no occurrence is upcoming", () => {
    expect(() =>
      plan({ occurrences: practiceSeries({ until: "2026-09-10" }), openedId: "occ-2026-09-10" })
    ).toThrow(SeriesEditError);
  });
});

describe("what an edit preserves (BUG-009, D4)", () => {
  it("keeps every occurrence id: nothing is deleted or re-inserted for a field or time change", () => {
    const p = plan({
      occurrences: practiceSeries(),
      fields: { location_id: "loc-new" },
      time: { start: "17:00", end: "18:30" },
    });

    expect(p.inserts).toHaveLength(0);
    expect(p.cancels).toHaveLength(0);
    expect(ids(p.updates).every((id) => id.startsWith("occ-"))).toBe(true);
  });

  it("moves the time of day but keeps each date, across the daylight-saving change", () => {
    const p = plan({
      occurrences: practiceSeries({ until: "2026-11-12" }),
      time: { start: "17:30", end: "19:00" },
    });

    for (const u of p.updates) {
      expect(localTime(u.start_time!)).toBe("17:30");
      expect(localTime(u.end_time!)).toBe("19:00");
      expect(`occ-${localDate(u.start_time!)}`).toBe(u.id);
    }
    expect(ids(p.updates)).toContain("occ-2026-10-29"); // PDT
    expect(ids(p.updates)).toContain("occ-2026-11-05"); // PST
  });

  it("leaves an individually cancelled occurrence cancelled and unedited", () => {
    const rows = with_(practiceSeries(), "occ-2026-10-01", { is_cancelled: true });
    const p = plan({ occurrences: rows, fields: { location_id: "loc-new" }, time: { start: "17:00", end: "18:30" } });

    expect(ids(p.updates)).not.toContain("occ-2026-10-01");
    expect(p.cancels).not.toContain("occ-2026-10-01");
    expect(p.reparent).toContain("occ-2026-10-01");
    expect(p.preview.unchanged).toContain(at("2026-10-01"));
  });

  it("leaves an individually rescheduled occurrence at its own time", () => {
    const rows = with_(practiceSeries(), "occ-2026-10-08", {
      start_time: at("2026-10-08", "18:00"),
      end_time: at("2026-10-08", "19:30"),
    });
    const p = plan({ occurrences: rows, fields: { location_id: "loc-new" }, time: { start: "17:00", end: "18:30" } });

    expect(ids(p.updates)).not.toContain("occ-2026-10-08");
    expect(p.inserts.map((i) => localDate(i.start_time))).not.toContain("2026-10-08");
  });

  it("does not choose a cancelled occurrence as the new head", () => {
    const rows = with_(practiceSeries(), "occ-2026-09-17", { is_cancelled: true });
    const p = plan({ occurrences: rows, fields: { notes: "x" } });

    expect(p.newHeadId).toBe("occ-2026-09-24");
    expect(p.reparent).toContain("occ-2026-09-17");
  });

  it("never applies results or scores in a bulk edit", () => {
    const p = plan({
      occurrences: practiceSeries(),
      fields: { location_id: "loc-new" },
      pattern: { frequency: "weekly", daysOfWeek: [THURSDAY], untilDate: "2026-11-12" },
    });

    for (const change of [...p.updates.map((u) => u.fields), ...p.inserts.map((i) => i.fields)]) {
      expect(change).not.toHaveProperty("game_result");
      expect(change).not.toHaveProperty("score_for");
      expect(change).not.toHaveProperty("score_against");
    }
  });

  it("recognises occurrences of a legacy rule that has no DTSTART", () => {
    const p = plan({ occurrences: practiceSeries({ legacy: true }), time: { start: "17:00", end: "18:30" } });

    expect(ids(p.updates)).toHaveLength(7);
    expect(p.inserts).toHaveLength(0);
  });
});

describe("pattern changes (BUG-009, D4)", () => {
  it("extending the end date adds new occurrences with no history", () => {
    const p = plan({
      occurrences: practiceSeries(),
      pattern: { frequency: "weekly", daysOfWeek: [THURSDAY], untilDate: "2026-11-12" },
    });

    expect(p.inserts.map((i) => localDate(i.start_time))).toEqual(["2026-11-05", "2026-11-12"]);
    expect(p.inserts.every((i) => localTime(i.start_time) === "16:00")).toBe(true);
    expect(p.inserts[0].fields).toMatchObject({ title: "Practice", location_id: "loc-old", arrival_time: 15 });
    expect(p.cancels).toHaveLength(0);
    expect(p.preview.added).toEqual([at("2026-11-05"), at("2026-11-12")]);
  });

  it("the end date is inclusive: a series until Nov 5 includes the Nov 5 practice", () => {
    const p = plan({
      occurrences: practiceSeries(),
      pattern: { frequency: "weekly", daysOfWeek: [THURSDAY], untilDate: "2026-11-05" },
    });

    expect(p.inserts.map((i) => localDate(i.start_time))).toEqual(["2026-11-05"]);
  });

  it("shortening the end date cancels the removed occurrences instead of deleting them", () => {
    const p = plan({
      occurrences: practiceSeries(),
      pattern: { frequency: "weekly", daysOfWeek: [THURSDAY], untilDate: "2026-10-15" },
    });

    expect(p.cancels).toEqual(["occ-2026-10-22", "occ-2026-10-29"]);
    expect(p.inserts).toHaveLength(0);
    expect(p.preview.cancelled).toEqual([at("2026-10-22"), at("2026-10-29")]);
  });

  it("moving to a different weekday cancels the old dates and adds new ones — no availability is transferred", () => {
    const WEDNESDAY = 2;
    const p = plan({
      occurrences: practiceSeries(),
      pattern: { frequency: "weekly", daysOfWeek: [WEDNESDAY], untilDate: "2026-10-29" },
    });

    expect(p.cancels).toEqual(weeklyThursdays("2026-09-17", "2026-10-29").map((d) => `occ-${d}`));
    expect(p.inserts.map((i) => localDate(i.start_time))).toEqual([
      "2026-09-23", "2026-09-30", "2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28",
    ]);
    expect(p.updates).toHaveLength(0);
    expect(p.newHeadId).toBe(p.inserts[0].id);
  });

  it("switching to every two weeks keeps alternate occurrences and cancels the rest", () => {
    const p = plan({
      occurrences: practiceSeries(),
      pattern: { frequency: "biweekly", daysOfWeek: [THURSDAY], untilDate: "2026-10-29" },
    });

    expect(p.cancels).toEqual(["occ-2026-09-24", "occ-2026-10-08", "occ-2026-10-22"]);
    expect(p.inserts).toHaveLength(0);
  });

  it("writes the new series rule with an explicit DTSTART at the new time", () => {
    const p = plan({
      occurrences: practiceSeries(),
      time: { start: "17:30", end: "19:00" },
      pattern: { frequency: "weekly", daysOfWeek: [THURSDAY], untilDate: "2026-10-29" },
    });

    const rule = RRule.fromString(p.newHeadRule);
    expect(rule.origOptions.dtstart!.toISOString()).toBe("2026-09-17T17:30:00.000Z");
    expect(rule.origOptions.until!.toISOString()).toBe("2026-10-29T23:59:59.000Z");
  });

  it("does not add an occurrence on a date already held by a rescheduled one", () => {
    const rows = with_(practiceSeries(), "occ-2026-10-08", {
      start_time: at("2026-10-08", "18:00"),
      end_time: at("2026-10-08", "19:30"),
    });
    const p = plan({
      occurrences: rows,
      pattern: { frequency: "weekly", daysOfWeek: [THURSDAY], untilDate: "2026-10-29" },
      time: { start: "17:00", end: "18:30" },
    });

    expect(p.inserts.map((i) => localDate(i.start_time))).not.toContain("2026-10-08");
  });
});

describe("deleting the series head (BUG-009)", () => {
  it("gives the promoted head a rule that keeps the original pattern start", () => {
    const [head] = practiceSeries({ legacy: true });

    const rule = RRule.fromString(pinnedStartRule(head, PACIFIC));
    expect(rule.origOptions.dtstart!.toISOString()).toBe("2026-09-03T16:00:00.000Z");
    expect(rule.origOptions.byweekday).toBeDefined();
  });

  it("keeps an existing DTSTART unchanged, and records the series' zone", () => {
    const [head] = practiceSeries({ from: "2026-09-10" });
    const pinned = RRule.fromString(pinnedStartRule(head, PACIFIC)).origOptions;

    expect(pinned.dtstart!.toISOString()).toBe("2026-09-10T16:00:00.000Z");
    expect(pinned.tzid).toBe(PACIFIC);
  });
});

describe("the series' own timezone (BUG-010, D5)", () => {
  // The editing device is in Pacific time (pinned above); this series is in Denver.
  const denver = () => practiceSeries({ zone: DENVER });

  it("recognises a Denver series edited from a Pacific device", () => {
    const p = plan({ occurrences: denver(), timeZone: DENVER, fields: { notes: "Bring cones" } });

    // Read in the device's zone, every 4 PM Denver occurrence looked like a 3 PM
    // reschedule, so nothing was updated.
    expect(ids(p.updates)).toEqual(weeklyThursdays("2026-09-17", "2026-10-29").map((d) => `occ-${d}`));
    expect(p.preview.unchanged).toHaveLength(0);
  });

  it("moves the time of day in the series' zone, across the daylight-saving change", () => {
    const p = plan({ occurrences: denver(), timeZone: DENVER, time: { start: "18:00", end: "19:30" } });

    const moved = p.updates.map((u) => wallClockIn(u.start_time!, DENVER));
    expect(moved).toEqual(weeklyThursdays("2026-09-17", "2026-10-29").map((d) => `${d}T18:00`));
    expect(p.updates.map((u) => wallClockIn(u.end_time!, DENVER).slice(11))).toEqual(moved.map(() => "19:30"));
  });

  it("adds new occurrences at the local time in the series' zone", () => {
    const p = plan({
      occurrences: denver(),
      timeZone: DENVER,
      pattern: { frequency: "weekly", daysOfWeek: [THURSDAY], untilDate: "2026-11-12" },
    });

    // Nov 5 and 12 are after the daylight-saving change: still 4 PM in Denver.
    expect(p.inserts.map((i) => wallClockIn(i.start_time, DENVER))).toEqual(["2026-11-05T16:00", "2026-11-12T16:00"]);
    expect(p.inserts.every((i) => i.fields.timezone === DENVER)).toBe(true);
  });

  it("changing the zone keeps the local clock time and records the new zone", () => {
    const p = plan({ occurrences: practiceSeries(), timeZone: PACIFIC, newTimeZone: DENVER });

    // 4 PM Pacific becomes 4 PM Denver: one hour earlier as an instant.
    expect(p.updates.map((u) => wallClockIn(u.start_time!, DENVER))).toEqual(
      weeklyThursdays("2026-09-17", "2026-10-29").map((d) => `${d}T16:00`)
    );
    expect(p.updates.every((u) => u.fields.timezone === DENVER)).toBe(true);
    // Past occurrences stay where, and in the zone, they happened.
    expect(ids(p.updates)).not.toContain("occ-2026-09-10");
  });

  it("an explicit time and a new zone together put the new time in the new zone", () => {
    const p = plan({
      occurrences: practiceSeries(),
      timeZone: PACIFIC,
      newTimeZone: DENVER,
      time: { start: "09:00", end: "10:00" },
    });

    expect(wallClockIn(p.updates[0].start_time!, DENVER)).toBe("2026-09-17T09:00");
  });

  it("an occurrence rescheduled on its own keeps its instant when the zone changes", () => {
    const rows = with_(practiceSeries(), "occ-2026-10-08", {
      start_time: at("2026-10-08", "17:00"),
      end_time: at("2026-10-08", "18:30"),
    });

    const p = plan({ occurrences: rows, timeZone: PACIFIC, newTimeZone: DENVER });

    expect(ids(p.updates)).not.toContain("occ-2026-10-08");
    expect(p.preview.unchanged).toEqual([at("2026-10-08", "17:00")]);
  });

  it("pins a legacy rule's start in the series' zone, not the device's", () => {
    const [head] = practiceSeries({ legacy: true, zone: DENVER });

    expect(RRule.fromString(pinnedStartRule(head, DENVER)).origOptions.dtstart!.toISOString()).toBe(
      "2026-09-03T16:00:00.000Z"
    );
  });
});

describe("the pattern's zone is the series', not the opened occurrence's (PR #81 review)", () => {
  /** A Denver series whose rule names its zone, as rules created after BUG-010 do. */
  function denverWithTzid() {
    return practiceSeries({ zone: DENVER }).map((r) =>
      r.recurrence_rule
        ? { ...r, recurrence_rule: new RRule({ ...RRule.fromString(r.recurrence_rule).origOptions, tzid: DENVER }).toString() }
        : r
    );
  }

  /** Move one occurrence to 4 PM Pacific on its own. */
  function toPacific(rows: EventRow[], id: string) {
    const date = id.slice(4);
    return with_(rows, id, {
      timezone: PACIFIC,
      start_time: instantFromWallClock(`${date}T16:00`, PACIFIC).toISOString(),
      end_time: instantFromWallClock(`${date}T17:30`, PACIFIC).toISOString(),
    });
  }

  it("opened from an occurrence moved to another zone, the regular ones are still edited", () => {
    // The caller's zone is only a fallback: the head says Denver.
    const rows = toPacific(practiceSeries({ zone: DENVER }), "occ-2026-09-24");

    const p = plan({ occurrences: rows, openedId: "occ-2026-09-24", timeZone: PACIFIC, fields: { title: "Updated" } });

    expect(ids(p.updates)).toContain("occ-2026-09-17");
    expect(ids(p.updates)).toContain("occ-2026-10-01");
    // The moved one is an exception, and is left as it is.
    expect(ids(p.updates)).not.toContain("occ-2026-09-24");
  });

  it("a head moved to another zone on its own does not move the pattern", () => {
    const rows = toPacific(denverWithTzid(), "occ-2026-09-03");

    expect(seriesTimeZone(rows[0], PACIFIC)).toBe(DENVER);
    const p = plan({ occurrences: rows, timeZone: PACIFIC, fields: { title: "Updated" } });
    expect(ids(p.updates)).toEqual(weeklyThursdays("2026-09-17", "2026-10-29").map((d) => `occ-${d}`));
  });

  it("pinning a legacy head records the zone it had before its own edit", () => {
    const [head] = practiceSeries({ legacy: true, zone: DENVER });

    const pinned = RRule.fromString(pinnedStartRule(head, PACIFIC)).origOptions;
    expect(pinned.tzid).toBe(DENVER);
    expect(pinned.dtstart!.toISOString()).toBe("2026-09-03T16:00:00.000Z");
  });

  it("the new head's rule names the new zone; the truncated rule keeps the old", () => {
    const p = plan({ occurrences: practiceSeries(), timeZone: PACIFIC, newTimeZone: DENVER });

    expect(RRule.fromString(p.newHeadRule).origOptions.tzid).toBe(DENVER);
    expect(RRule.fromString(p.truncateRule!).origOptions.tzid).toBe(PACIFIC);
  });
});
