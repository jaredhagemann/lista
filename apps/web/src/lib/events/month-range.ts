/**
 * Calendar month boundaries, in the team's timezone (BUG-014, spec §5).
 *
 * A month is a local calendar range, not a fixed number of hours: March in
 * Pacific time is 743 hours long, November 721. Deriving the next boundary by
 * adding 24 hours thirty-one times lands an hour out either side of a DST
 * change, which quietly moves an event between months.
 *
 * Boundaries are half-open — `start_time >= from` and `< to` — so an event at
 * exactly midnight belongs to the month that is beginning, once.
 *
 * The same zone groups events into day cells, so the grid can never place an
 * event on a day the month query did not fetch.
 */

import { resolveTimeZone } from "@/lib/notifications/event-time";

/** "2026-12". */
export type MonthKey = string;

export type MonthRange = {
  fromInclusive: string;
  toExclusive: string;
};

/**
 * The zone's offset from UTC at a given instant, in milliseconds.
 *
 * Read from the formatted parts rather than assumed: the offset depends on the
 * instant, which is the whole point.
 */
function offsetAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // `hour` can be 24 under hour12: false at midnight in some engines.
  const hour = get("hour") % 24;

  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second")
  );
  return asIfUtc - utcMs;
}

/** The UTC instant of a local wall-clock time in a zone. */
function zonedToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string
): Date {
  const wallClock = Date.UTC(year, month - 1, day, 0, 0, 0);
  // One correction pass settles all but the hour that repeats or does not
  // exist at a DST change, and a second pass settles that.
  const firstGuess = wallClock - offsetAt(wallClock, timeZone);
  const corrected = wallClock - offsetAt(firstGuess, timeZone);
  return new Date(corrected);
}

function parseKey(key: MonthKey): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) throw new Error(`Not a month: ${key}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** The half-open UTC range covering a local calendar month. */
export function monthRange(key: MonthKey, timeZone: string | null | undefined): MonthRange {
  const zone = resolveTimeZone(timeZone);
  const { year, month } = parseKey(key);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    fromInclusive: zonedToUtc(year, month, 1, zone).toISOString(),
    toExclusive: zonedToUtc(nextYear, nextMonth, 1, zone).toISOString(),
  };
}

/** Which month an instant falls in, read in the grid's zone. */
export function monthKeyOf(instant: string | Date, timeZone: string | null | undefined): MonthKey {
  const zone = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(instant));

  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

/** Which day cell an event belongs in, read in the grid's zone. */
export function dayKeyOf(instant: string | Date, timeZone: string | null | undefined): string {
  const zone = resolveTimeZone(timeZone);
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

/** Steps a month key, across year boundaries. */
export function addMonths(key: MonthKey, delta: number): MonthKey {
  const { year, month } = parseKey(key);
  const zeroBased = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = (zeroBased % 12) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

/** The month key for a Date as the grid sees it. */
export function currentMonthKey(timeZone: string | null | undefined, now: Date = new Date()): MonthKey {
  return monthKeyOf(now, timeZone);
}

/** How many days the month has. */
export function daysInMonth(key: MonthKey): number {
  const { year, month } = parseKey(key);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Which column the first of the month falls in, 0 = Sunday, read in the grid's
 * zone. Reading it from the browser's zone would shift the whole grid by a day
 * for anyone travelling.
 */
export function firstWeekdayOf(key: MonthKey, timeZone: string | null | undefined): number {
  const { fromInclusive } = monthRange(key, timeZone);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    weekday: "short",
  }).format(new Date(fromInclusive));
  return Math.max(0, WEEKDAYS.indexOf(label));
}

/** "December 2026", in the grid's zone. */
export function monthLabelOf(key: MonthKey, timeZone: string | null | undefined): string {
  const { fromInclusive } = monthRange(key, timeZone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    month: "long",
    year: "numeric",
  }).format(new Date(fromInclusive));
}
