import { createClient } from "@/lib/supabase/client";
import { sanitizeNext } from "@/lib/auth/sanitize-next";

export { sanitizeNext };

/**
 * Initiates Supabase OAuth with Google.
 *
 * `redirectTo` is derived from `window.location.origin` so the round-trip
 * returns to the **same host** the user started on — root or club
 * subdomain — per spec R3. `next` is sanitised and appended so post-login
 * routing (dashboard vs invite acceptance) survives the round-trip (R6).
 *
 * The same sanitiser runs server-side in `/auth/callback`; this is the
 * client-side first line of defence so a poisoned `next` never even leaves
 * the browser.
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
