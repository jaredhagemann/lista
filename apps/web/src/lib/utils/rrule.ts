import { RRule, RRuleSet } from "rrule";

export function parseRRule(rruleString: string): {
  interval: 1 | 2;
  daysOfWeek: number[];
  until: Date | null;
} {
  const rule = RRule.fromString(rruleString);
  const { interval = 1, byweekday, until } = rule.origOptions;
  const days = byweekday
    ? (Array.isArray(byweekday) ? byweekday : [byweekday]).map(
        (d: unknown) => {
          if (typeof d === "number") return d;
          return (d as { weekday: number }).weekday;
        }
      )
    : [];
  return { interval: interval === 2 ? 2 : 1, daysOfWeek: days, until: until ?? null };
}

export interface RecurrenceConfig {
  frequency: "weekly" | "biweekly";
  daysOfWeek: number[]; // 0=Monday, 1=Tuesday, ..., 6=Sunday (rrule convention)
  until: Date;
  /**
   * Where the pattern starts, as a wall-clock time labeled UTC (rrule's convention).
   * Stored as DTSTART so the pattern does not depend on the head event's current
   * start time, which single-event edits and head promotion can change (BUG-009).
   */
  dtstart?: Date;
  /**
   * The zone the pattern's wall-clock times are in, stored as DTSTART;TZID (BUG-010).
   * It belongs to the pattern, so it survives any single occurrence — the head
   * included — moving to another zone.
   */
  tzid?: string;
}

export function buildRRule(config: RecurrenceConfig): string {
  const rule = new RRule({
    freq: RRule.WEEKLY,
    interval: config.frequency === "biweekly" ? 2 : 1,
    byweekday: config.daysOfWeek,
    until: config.until,
    ...(config.dtstart ? { dtstart: config.dtstart } : {}),
    ...(config.tzid ? { tzid: config.tzid } : {}),
  });
  return rule.toString();
}

/** The zone a rule names in DTSTART;TZID, if any. Rules from before BUG-010 name none. */
export function ruleTimeZone(rruleString: string): string | undefined {
  return RRule.fromString(rruleString).origOptions.tzid ?? undefined;
}

/**
 * A rule's options for expansion, without its TZID.
 *
 * Given a TZID, rrule converts every result into the zone the code runs in —
 * the device's — which is exactly the dependence BUG-010 removed. Expansion
 * works in wall-clock times labeled UTC; the caller reads them in the zone.
 */
export function expansionOptions(rruleString: string) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tzid, ...options } = RRule.fromString(rruleString).origOptions;
  return options;
}

/** The inclusive end of a "repeat until" date, in rrule's wall-clock convention (BUG-010). */
export function untilEndOfDay(date: string): Date {
  return new Date(`${date}T23:59:59.000Z`);
}

export function expandRecurrence(
  rruleString: string,
  startTime: Date,
  rangeStart?: Date,
  rangeEnd?: Date
): Date[] {
  const ruleSet = new RRuleSet();

  // Adjust rule to use the event's start time
  const adjustedRule = new RRule({
    ...expansionOptions(rruleString),
    dtstart: startTime,
  });

  ruleSet.rrule(adjustedRule);

  if (rangeStart && rangeEnd) {
    return ruleSet.between(rangeStart, rangeEnd, true);
  }

  return ruleSet.all();
}

/**
 * Expands a recurrence rule starting from a local datetime string, returning real UTC
 * timestamps.
 *
 * The rrule library treats all dates as UTC wall-clock times. If you pass a JS Date
 * created from a local datetime string (e.g. `new Date("2026-02-25T16:00")`), rrule
 * uses its UTC representation — which in western timezones can be on the next calendar
 * day (4 PM PST = midnight UTC Thursday). This causes child events to land on the wrong
 * day and the first occurrence to be skipped.
 *
 * This function avoids the problem by parsing the datetime string as UTC so that rrule's
 * arithmetic matches the user's wall-clock intent, then converting each result back to a
 * real UTC timestamp via `wallClockToTimestamp`.
 *
 * @param startTimeLocal - datetime-local format string ("2026-02-25T16:00"), no TZ info
 * @param rruleString - RFC 5545 RRULE string
 * @param wallClockToTimestamp - converts a "UTC wall-clock" Date produced by rrule into
 *   a real UTC timestamp. Defaults to re-interpreting the UTC components as local time,
 *   which is DST-safe. Pass a custom function in tests to simulate a specific UTC offset.
 */
export function expandRecurrenceFromLocalString(
  startTimeLocal: string,
  rruleString: string,
  wallClockToTimestamp: (d: Date) => Date = (d) =>
    new Date(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes()
    )
): Date[] {
  // Parse as UTC so rrule's UTC arithmetic aligns with the user's wall-clock intent.
  // "2026-02-25T16:00" + ":00.000Z" → 2026-02-25T16:00:00.000Z (Wednesday 4 PM in UTC)
  // rather than 2026-02-26T00:00:00.000Z (Thursday midnight UTC, the PST→UTC conversion).
  const startUTCWallClock = new Date(startTimeLocal + ":00.000Z");

  const ruleSet = new RRuleSet();
  const adjustedRule = new RRule({
    ...expansionOptions(rruleString),
    dtstart: startUTCWallClock,
  });
  ruleSet.rrule(adjustedRule);

  return ruleSet.all().map(wallClockToTimestamp);
}

export function getRecurrenceDescription(rruleString: string): string {
  try {
    const rule = RRule.fromString(rruleString);
    return rule.toText();
  } catch {
    return "Recurring event";
  }
}
