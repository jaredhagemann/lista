/**
 * Each event type's color, on every page (decided 2026-10-08): practice blue,
 * game green, tournament purple, other yellow. The only place a type's color is
 * defined, so pages can't drift apart (tests/event-type-colors.test.tsx checks
 * that nothing else uses purple or yellow). The phone uses the same colors, in
 * apps/mobile/lib/event-type-colors.ts.
 *
 * Amber is not a type color: it's Maybe's, and the forms' warnings'. Other is
 * yellow, a lighter, cooler yellow, with dark text so it stays legible.
 */

export type EventTypeStyle = {
  /** A badge: background and text, light and dark. */
  badge: string;
  /** A calendar chip's background, and its text. */
  chipBg: string;
  chipText: string;
  /** A calendar dot or bar. */
  dot: string;
};

export const EVENT_TYPE_STYLES = {
  practice: {
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    chipBg: "bg-blue-100 dark:bg-blue-900/40",
    chipText: "text-blue-700 dark:text-blue-300",
    dot: "bg-blue-600",
  },
  game: {
    badge: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    chipBg: "bg-green-100 dark:bg-green-900/40",
    chipText: "text-green-700 dark:text-green-300",
    dot: "bg-green-600",
  },
  tournament: {
    badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    chipBg: "bg-purple-100 dark:bg-purple-900/40",
    chipText: "text-purple-700 dark:text-purple-300",
    dot: "bg-purple-600",
  },
  other: {
    badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
    chipBg: "bg-yellow-100 dark:bg-yellow-900/40",
    chipText: "text-yellow-800 dark:text-yellow-200",
    dot: "bg-yellow-500",
  },
} satisfies Record<string, EventTypeStyle>;

/** A type's colors; an unknown type is shown as other. */
export function eventTypeStyle(type: string): EventTypeStyle {
  return (EVENT_TYPE_STYLES as Record<string, EventTypeStyle>)[type] ?? EVENT_TYPE_STYLES.other;
}
