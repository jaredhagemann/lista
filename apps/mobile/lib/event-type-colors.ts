/**
 * Each event type's color, on every screen, as on the web (decided 2026-10-08):
 * practice blue, game green, tournament purple, other yellow. Keep in step with
 * apps/web/src/lib/events/type-colors.ts. The only place a type's color is
 * defined (__tests__/event-type-colors.test.tsx checks the screens don't repeat
 * them).
 *
 * Amber is not a type color: it's a Maybe answer's. Other is a lighter, cooler
 * yellow, with dark text so it stays legible.
 */

export type EventTypeColors = { bg: string; text: string };

export const EVENT_TYPE_COLORS = {
  practice: { bg: "#dbeafe", text: "#1d4ed8" },
  game: { bg: "#dcfce7", text: "#15803d" },
  tournament: { bg: "#f3e8ff", text: "#7e22ce" },
  other: { bg: "#fef9c3", text: "#854d0e" },
} satisfies Record<string, EventTypeColors>;

/** A type's pill colors; an unknown type is shown as other. */
export function eventTypeColors(type: string): EventTypeColors {
  return (EVENT_TYPE_COLORS as Record<string, EventTypeColors>)[type] ?? EVENT_TYPE_COLORS.other;
}

/** "Surf Cup · Semifinal" under a game: its tournament's color. */
export const PART_OF_COLOR = EVENT_TYPE_COLORS.tournament.text;
