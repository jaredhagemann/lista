/**
 * How a stored value reads on screen (spec: docs/specs/team-branding-and-labels.md §1).
 *
 * Event types, roles, guardian relationships, home/away and game results are
 * stored lowercase ("game", "mom", "coach"). Show them through this, never raw
 * and never with the `capitalize` class, so every place reads the same way.
 */
export function displayLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/(^|[\s-])(\p{Ll})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}
