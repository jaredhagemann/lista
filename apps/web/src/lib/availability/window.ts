/**
 * The availability matrix's date windows (BUG-014, spec §5 and §7).
 *
 * The matrix used to load every event a team had ever held, and every response
 * to all of them — the query that reached the API's row cap first, because
 * responses multiply events by players. It now covers a window, and the number
 * of rows follows what is on screen rather than how long the team has existed.
 *
 * Every window is measured from an **anchor** that is frozen for the session.
 * Recomputing "now" between pages would slide the window underneath the reader,
 * so page two could skip an event page one had shown, or show it twice. These
 * are rolling 24-hour windows, unlike calendar months.
 */

import { resolveTimeZone } from "@/lib/notifications/event-time";

export type AvailabilityWindow = "upcoming" | "past" | "season";

export const AVAILABILITY_WINDOWS: { value: AvailabilityWindow; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past 30 days" },
  { value: "season", label: "Wider range" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseWindow(value: string | undefined | null): AvailabilityWindow {
  return value === "past" || value === "season" ? value : "upcoming";
}

/** A fresh anchor. Taken once per query session, never per page. */
export function newAnchor(now: Date = new Date()): string {
  return now.toISOString();
}

export function windowRange(
  window: AvailabilityWindow,
  anchor: string
): { fromInclusive: string; toExclusive: string } {
  const at = Date.parse(anchor);

  switch (window) {
    case "past":
      return {
        fromInclusive: new Date(at - 30 * DAY_MS).toISOString(),
        toExclusive: new Date(at).toISOString(),
      };
    case "season":
      return {
        fromInclusive: new Date(at - 365 * DAY_MS).toISOString(),
        toExclusive: new Date(at + 365 * DAY_MS).toISOString(),
      };
    case "upcoming":
    default:
      return {
        fromInclusive: new Date(at).toISOString(),
        toExclusive: new Date(at + 180 * DAY_MS).toISOString(),
      };
  }
}

function formatDay(instant: string, timeZone: string | null | undefined): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(instant));
}

/**
 * What the reader is looking at.
 *
 * The wider range names its actual dates. Calling it "whole season" would be a
 * claim the data cannot support — there is no season record behind it, just a
 * rolling year either side of the anchor (spec §5).
 */
export function windowLabel(
  window: AvailabilityWindow,
  anchor: string,
  timeZone: string | null | undefined
): string {
  const range = windowRange(window, anchor);

  switch (window) {
    case "past":
      return `Events from the past 30 days, ${formatDay(range.fromInclusive, timeZone)} to ${formatDay(anchor, timeZone)}.`;
    case "season":
      return `Events from ${formatDay(range.fromInclusive, timeZone)} to ${formatDay(range.toExclusive, timeZone)}.`;
    case "upcoming":
    default:
      return `Upcoming events, through ${formatDay(range.toExclusive, timeZone)}.`;
  }
}
