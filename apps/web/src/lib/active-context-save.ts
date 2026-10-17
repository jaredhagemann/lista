import { cookies } from "next/headers";
import {
  ACTIVE_CONTEXT_COOKIE,
  LEGACY_PROFILE_COOKIE,
  contextCookieOptions,
  encodeContext,
  type SavedContext,
} from "@/lib/active-context-cookie";

/**
 * Saves this device's context (D1). Only for server actions and route handlers,
 * which can set cookies; callers check the tuple first (D6).
 *
 * It also retires the old profile-only cookie (review DC-002), in the same
 * scope as the context cookie. One response can clear only one scope of a
 * cookie name, so a copy left in the other scope (host-only, from before) may
 * survive; the chooser ignores it once this account has a saved context.
 */
export async function saveContextCookie(context: SavedContext) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CONTEXT_COOKIE, encodeContext(context), contextCookieOptions());
  cookieStore.set(LEGACY_PROFILE_COOKIE, "", contextCookieOptions({ maxAge: 0 }));
}
