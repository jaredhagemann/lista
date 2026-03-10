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
}

export function buildRRule(config: RecurrenceConfig): string {
  const rule = new RRule({
    freq: RRule.WEEKLY,
    interval: config.frequency === "biweekly" ? 2 : 1,
    byweekday: config.daysOfWeek,
    until: config.until,
  });
  return rule.toString();
}

export function expandRecurrence(
  rruleString: string,
  startTime: Date,
  rangeStart?: Date,
  rangeEnd?: Date
): Date[] {
  const ruleSet = new RRuleSet();
  const rule = RRule.fromString(rruleString);

  // Adjust rule to use the event's start time
  const adjustedRule = new RRule({
    ...rule.origOptions,
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
  const rule = RRule.fromString(rruleString);
  const adjustedRule = new RRule({
    ...rule.origOptions,
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
