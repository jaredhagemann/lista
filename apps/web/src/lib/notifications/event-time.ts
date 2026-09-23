/**
 * Date and time formatting for event notifications (BUG-020).
 *
 * Notifications are built on the server, which runs in UTC. Every formatter here
 * takes the timezone explicitly — the team's, per decision D5 an event's default
 * — and labels times with it, so output never depends on the server's zone and a
 * time is never shown without saying which zone it is in.
 */

const LOCALE = "en-US";

/** The team's IANA timezone if valid; otherwise UTC (always labeled as such). */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** "Thursday, September 17, 2026" */
export function formatEventDate(instant: string | Date, timeZone: string): string {
  return new Date(instant).toLocaleDateString(LOCALE, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
}

/** "Thu, Sep 17" */
export function formatShortEventDate(instant: string | Date, timeZone: string): string {
  return new Date(instant).toLocaleDateString(LOCALE, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
}

function formatTime(instant: string | Date, timeZone: string): string {
  return new Date(instant).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit", timeZone });
}

/** Short zone name at that instant: "PDT", "PST", "UTC" (or "GMT+2" where no abbreviation exists). */
function zoneLabel(instant: string | Date, timeZone: string): string {
  return (
    new Intl.DateTimeFormat(LOCALE, { timeZone, timeZoneName: "short" })
      .formatToParts(new Date(instant))
      .find((part) => part.type === "timeZoneName")?.value ?? timeZone
  );
}

/** "America/Denver (MDT)" — the zone's name, with its abbreviation at that instant. */
export function formatZoneName(timeZone: string, at: string | Date = new Date()): string {
  const label = zoneLabel(at, timeZone);
  const name = timeZone.replace(/_/g, " ");
  return label === timeZone ? name : `${name} (${label})`;
}

/** "4:00 PM PDT" */
export function formatEventTime(instant: string | Date, timeZone: string): string {
  return `${formatTime(instant, timeZone)} ${zoneLabel(instant, timeZone)}`;
}

/** "4:00 PM – 5:30 PM PDT" */
export function formatEventTimeRange(start: string | Date, end: string | Date, timeZone: string): string {
  return `${formatTime(start, timeZone)} – ${formatTime(end, timeZone)} ${zoneLabel(start, timeZone)}`;
}

function localDate(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Whether the event is "today" or "tomorrow" in the given timezone, relative to
 * `now`; null for any other day.
 */
export function relativeEventDay(
  start: string | Date,
  timeZone: string,
  now: Date = new Date()
): "today" | "tomorrow" | null {
  const eventDay = localDate(new Date(start), timeZone);
  const today = localDate(now, timeZone);
  if (eventDay === today) return "today";

  const [year, month, day] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return eventDay === tomorrow ? "tomorrow" : null;
}
