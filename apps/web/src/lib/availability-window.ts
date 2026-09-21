/**
 * Which events the availability matrix shows (BUG-014).
 *
 * It used to show every event the team had ever held, and fetch every response
 * to all of them — the query that reaches the API's 1,000-row cap first, since
 * responses multiply events by players. A season of 50 events and 21 players is
 * already 1,050 rows, and the ones it dropped rendered as "no response".
 *
 * Windowing fixes that at the source: the number of rows now follows what is on
 * screen rather than how long the team has existed.
 */

export type AvailabilityWindow = "upcoming" | "past" | "season";

export const AVAILABILITY_WINDOWS: { value: AvailabilityWindow; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past 30 days" },
  { value: "season", label: "Whole season" },
];

export function parseWindow(value: string | undefined): AvailabilityWindow {
  return value === "past" || value === "season" ? value : "upcoming";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The event range for a window, as ISO bounds. "Season" is deliberately a range
 * rather than everything: a year of events either side is more than any coach
 * scrolls, and it keeps the response count bounded.
 */
export function windowRange(
  window: AvailabilityWindow,
  now: Date = new Date()
): { from: string; to: string } {
  switch (window) {
    case "past":
      return {
        from: new Date(now.getTime() - 30 * DAY_MS).toISOString(),
        to: now.toISOString(),
      };
    case "season":
      return {
        from: new Date(now.getTime() - 365 * DAY_MS).toISOString(),
        to: new Date(now.getTime() + 365 * DAY_MS).toISOString(),
      };
    case "upcoming":
    default:
      return {
        from: now.toISOString(),
        to: new Date(now.getTime() + 180 * DAY_MS).toISOString(),
      };
  }
}

export function windowDescription(window: AvailabilityWindow): string {
  switch (window) {
    case "past":
      return "Events from the last 30 days.";
    case "season":
      return "Every event this season.";
    case "upcoming":
    default:
      return "See who's available for upcoming events.";
  }
}
