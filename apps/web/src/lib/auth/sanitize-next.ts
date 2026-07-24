/**
 * Open-redirect guard for `?next=` values used by auth routes and helpers.
 *
 * Belt-and-suspenders: Supabase already enforces a redirect-URI allow-list
 * (spec R3), but the `next` query param is what we concatenate onto our own
 * origin after the OAuth code exchange — so a value like `//evil.com` would
 * still produce `https://lista.team//evil.com`, which most clients normalise
 * to `https://evil.com`. We re-validate in-app to keep the round-trip safe
 * even if a `redirectTo` slips past the upstream allow-list.
 *
 * Returns `next` only if it is a same-origin path. Anything else falls back
 * to `/dashboard`.
 *
 * Rules (per spec "Sanitise next" item):
 *   - must be a non-empty string
 *   - must start with `/`
 *   - must not start with `//` (protocol-relative)
 *   - must not start with `/\` (some browsers normalise `\` → `/`)
 *   - the literal first character must be `/`, ruling out `javascript:`,
 *     `data:`, etc. (they fail the "starts with `/`" check)
 */
export const DEFAULT_NEXT = "/dashboard";

export function sanitizeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length === 0) return DEFAULT_NEXT;
  if (!next.startsWith("/")) return DEFAULT_NEXT;
  if (next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_NEXT;
  return next;
}
