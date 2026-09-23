/**
 * Event times in the event's own zone (BUG-010, decision D5).
 *
 * An event's local times mean something only in its zone: a 4 PM Denver practice
 * is at 4 PM MDT wherever the phone is. Every time is labeled with its zone so a
 * parent in another zone is never shown an unmarked clock time.
 *
 * Events from before event zones fall back to the team's zone; with neither, the
 * phone's own zone is used, and labeled too.
 */

const LOCALE = "en-US";

function usable(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The zone to show an event in, or undefined for the phone's own. */
export function eventZone(event: {
  timezone?: string | null;
  teams?: { timezone: string | null } | null;
}): string | undefined {
  if (usable(event.timezone)) return event.timezone;
  if (usable(event.teams?.timezone)) return event.teams!.timezone!;
  return undefined;
}

/** When to arrive: the start, less the arrival offset in minutes. */
export function arrivalInstant(start: string, arrivalMinutes: number): Date {
  return new Date(new Date(start).getTime() - arrivalMinutes * 60 * 1000);
}

/** "Thu, Sep 17" */
export function formatEventDay(instant: string | Date, zone: string | undefined): string {
  return new Date(instant).toLocaleDateString(LOCALE, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: zone,
  });
}

/** "4:00 PM MDT" */
export function formatEventClock(instant: string | Date, zone: string | undefined): string {
  return new Date(instant).toLocaleTimeString(LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
    timeZoneName: "short",
  });
}

/** "Thursday, September 17, 2026 at 4:00 PM MDT" */
export function formatEventDateTime(instant: string | Date, zone: string | undefined): string {
  const day = new Date(instant).toLocaleDateString(LOCALE, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: zone,
  });
  return `${day} at ${formatEventClock(instant, zone)}`;
}
