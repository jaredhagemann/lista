/**
 * How a stored value reads on screen: the web's rule, copied (spec:
 * docs/specs/mobile-next-build.md §4, D1). Keep in step with
 * apps/web/src/lib/labels.ts.
 *
 * Event types, roles, guardian relationships, home/away and game results are
 * stored lowercase ("game", "mom", "coach"). Show them through this, never raw
 * and never with a capitalize style, so every screen reads the same way.
 */
export function displayLabel(value: string | null | undefined): string {
  if (!value) return "—";
  // The web matches lowercase letters with \p{Ll}. Upper-casing the first
  // character of each word does the same without a Unicode property escape,
  // which not every Hermes release parses.
  return value.replace(/(^|[\s-])([^\s-])/g, (_, before: string, letter: string) => before + letter.toUpperCase());
}
