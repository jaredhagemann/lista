/**
 * The schedule's list: events in the order they're shown, with the Today divider
 * and where the list opens.
 *
 * Each event goes on the day it's shown on: an underway tournament's is today,
 * though it started days ago (docs/specs/tournaments-and-leagues.md §4); anything
 * else's, a cancelled tournament included, is its start. Ordering by that day
 * keeps what happened since a tournament began (yesterday's practice) above
 * Today, where it belongs (review TL-021).
 */

import { isTournament, isUnderway } from "./tournament";

type ScheduleEvent = {
  id: string;
  event_type: string;
  start_time: string;
  end_time: string;
  is_cancelled: boolean;
};

export type ScheduleItem<E> = { type: "event"; event: E } | { type: "today-divider" };

/** Midnight local time on the day of `d`. */
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function buildScheduleItems<E extends ScheduleEvent>(
  events: E[],
  now: Date = new Date()
): { items: ScheduleItem<E>[]; firstUpcomingIndex: number } {
  const today = startOfDay(now);
  const underway = (e: E) => isTournament(e) && !e.is_cancelled && isUnderway(e, now);
  // The day each is shown on; within a day, by start (a stable sort keeps ties).
  const shownOn = (e: E) => (underway(e) ? today.getTime() : startOfDay(new Date(e.start_time)).getTime());
  const ordered = [...events].sort(
    (a, b) => shownOn(a) - shownOn(b) || Date.parse(a.start_time) - Date.parse(b.start_time)
  );

  const items: ScheduleItem<E>[] = [];
  let dividerInserted = false;
  let firstUpcomingIndex = -1;

  for (const event of ordered) {
    // "Today" before the first event shown on or after today
    if (!dividerInserted && shownOn(event) >= today.getTime()) {
      items.push({ type: "today-divider" });
      dividerInserted = true;
    }

    // The first upcoming event, or a tournament on now, not cancelled: where the list opens
    if (firstUpcomingIndex === -1 && !event.is_cancelled && (underway(event) || new Date(event.start_time) >= now)) {
      firstUpcomingIndex = items.length;
    }

    items.push({ type: "event", event });
  }

  // All events are in the past: the divider goes at the end
  if (!dividerInserted) items.push({ type: "today-divider" });

  // Nothing upcoming: open at "Today"
  if (firstUpcomingIndex === -1) {
    firstUpcomingIndex = items.findIndex((i) => i.type === "today-divider");
  }

  return { items, firstUpcomingIndex };
}
