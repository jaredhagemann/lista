import { createClient } from "@/lib/supabase/client";

const DEFAULT_NEXT = "/dashboard";

/**
 * Belt-and-suspenders guard against open-redirect via `?next=`. The
 * `/auth/callback` route does the same check server-side; we run it here
 * before initiating the OAuth round-trip so a poisoned `next` never even
 * leaves the browser.
 *
 * Returns `next` only if it is a same-origin path. Anything else falls back
 * to `/dashboard`.
 */
export function sanitizeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length === 0) return DEFAULT_NEXT;
  if (!next.startsWith("/")) return DEFAULT_NEXT;
  // Protocol-relative (`//evil.com`) and backslash variant some browsers
  // normalise to `/` — both would escape the origin once concatenated.
  if (next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_NEXT;
  return next;
}

/**
 * Initiates Supabase OAuth with Google.
 *
 * `redirectTo` is derived from `window.location.origin` so the round-trip
 * returns to the **same host** the user started on — root or club
 * subdomain — per spec R3. `next` is sanitised and appended so post-login
 * routing (dashboard vs invite acceptance) survives the round-trip (R6).
 */
export async function signInWithGoogle(next?: string | null) {
  const supabase = createClient();
  const safeNext = sanitizeNext(next);
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;

  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        access_type: "offline",
        prompt: "select_account",
      },
    },
  });
}
