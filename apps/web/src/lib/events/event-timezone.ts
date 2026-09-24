/**
 * An event's own timezone (BUG-010, decision D5).
 *
 * Every event carries a named zone (`events.timezone`), defaulting to the team's
 * when it is created. Its date and time inputs are read in that zone, its times
 * are shown in it with a label, and a series keeps its local clock time in it
 * across daylight-saving changes. Nothing here consults the device's zone: the
 * editing coach may be anywhere.
 *
 * Wall-clock times are "YYYY-MM-DDTHH:mm" strings, the shape a datetime-local
 * input reads and writes.
 */

import { RRule, RRuleSet } from "rrule";
import { expansionOptions } from "@/lib/utils/rrule";

/** The zones offered first in a picker, and on the team settings form. */
export const COMMON_TIME_ZONES = [
  // North America
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Winnipeg",
  "America/Halifax",
  "America/St_Johns",
  "America/Mexico_City",
  // Central & South America
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Buenos_Aires",
  "America/Sao_Paulo",
  "America/Caracas",
  // Europe
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Zurich",
  "Europe/Stockholm",
  "Europe/Oslo",
  "Europe/Copenhagen",
  "Europe/Helsinki",
  "Europe/Warsaw",
  "Europe/Prague",
  "Europe/Vienna",
  "Europe/Budapest",
  "Europe/Bucharest",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Moscow",
  // Africa
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  // Middle East
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Kuwait",
  "Asia/Tehran",
  "Asia/Jerusalem",
  "Asia/Beirut",
  // Asia
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Colombo",
  "Asia/Kathmandu",
  "Asia/Tashkent",
  "Asia/Almaty",
  "Asia/Bangkok",
  "Asia/Ho_Chi_Minh",
  "Asia/Jakarta",
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Manila",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Seoul",
  "Asia/Tokyo",
  // Oceania
  "Australia/Perth",
  "Australia/Darwin",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Pacific/Fiji",
  // UTC
  "UTC",
];

/** Whether this engine can format in the zone. */
export function isUsableTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone an event is shown and edited in: its own, else the team's (events
 * from before event zones, on a team that had none then), else the fallback —
 * the viewer's zone in the browser, UTC on the server.
 */
export function eventTimeZone(
  event: { timezone?: string | null },
  teamTimeZone: string | null | undefined,
  fallback: string
): string {
  if (isUsableTimeZone(event.timezone)) return event.timezone;
  if (isUsableTimeZone(teamTimeZone)) return teamTimeZone;
  return fallback;
}

/** The common zones, plus any already in use that the list lacks, without repeats. */
export function timeZoneChoices(include: Array<string | null | undefined> = []): string[] {
  const extra = include.filter(
    (zone): zone is string => isUsableTimeZone(zone) && !COMMON_TIME_ZONES.includes(zone)
  );
  return [...new Set([...extra, ...COMMON_TIME_ZONES])];
}

// ── Wall clock ↔ instant ──────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

function wallParts(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Some engines still write midnight as 24.
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/**
 * The zone's offset from UTC at a given instant, in milliseconds.
 *
 * Read from the formatted parts rather than assumed: the offset depends on the
 * instant, which is the whole point.
 */
export function offsetAt(utcMs: number, timeZone: string): number {
  const p = wallParts(utcMs, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - (utcMs - (utcMs % 1000));
}

/** "YYYY-MM-DDTHH:mm" in the zone. */
export function wallClockIn(instant: string | Date, timeZone: string): string {
  const p = wallParts(new Date(instant).getTime(), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * The instant a wall-clock time names in the zone.
 *
 * Around a daylight-saving change a wall-clock time can happen twice or not at
 * all. Every reading of it lies within fourteen hours of the same clock time in
 * UTC (offsets run from -12 to +14), so the offsets 36 hours either side are the
 * ones in force before and after any change near it — twelve hours was not
 * enough for Auckland, at +12/+13 (PR #81 review). A repeated time takes the
 * earlier instant, and a skipped one moves forward past the gap (2:30 AM on a
 * spring-forward night becomes 3:30 AM), as calendar apps do.
 */
export function instantFromWallClock(wall: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!match) throw new Error(`Not a wall-clock time: ${wall}`);
  const [, y, mo, d, h, mi] = match.map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi);
  const target = wall.slice(0, 16);

  const MARGIN = 36 * 60 * 60 * 1000;
  const before = asIfUtc - offsetAt(asIfUtc - MARGIN, timeZone);
  const after = asIfUtc - offsetAt(asIfUtc + MARGIN, timeZone);
  const matching = [before, after].filter((ms) => wallClockIn(new Date(ms), timeZone) === target);
  if (matching.length > 0) return new Date(Math.min(...matching));
  // Skipped by a spring-forward change: read with the offset in force before it.
  return new Date(before);
}

// ── Recurrence ────────────────────────────────────────────────────────────────

/**
 * Every start of a rule from a wall-clock start, as instants in the zone.
 *
 * rrule works in wall-clock times labeled UTC, so the pattern is expanded that
 * way and each result is then read in the event's zone. A series therefore keeps
 * its local clock time across daylight-saving changes, whatever the device's zone.
 */
export function expandInZone(startWall: string, rruleString: string, timeZone: string): Date[] {
  const set = new RRuleSet();
  set.rrule(new RRule({ ...expansionOptions(rruleString), dtstart: new Date(`${startWall}:00.000Z`) }));
  // Series always have an end date; the cap only guards against a malformed rule.
  return set
    .all((_, i) => i < 1000)
    .map((d) => instantFromWallClock(d.toISOString().slice(0, 16), timeZone));
}
