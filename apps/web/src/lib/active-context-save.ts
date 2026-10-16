import { cookies } from "next/headers";
import {
  ACTIVE_CONTEXT_COOKIE,
  contextCookieOptions,
  encodeContext,
  type SavedContext,
} from "@/lib/active-context-cookie";

/**
 * Saves this device's context (D1). Only for server actions and route handlers,
 * which can set cookies; callers check the tuple first (D6).
 */
export async function saveContextCookie(context: SavedContext) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CONTEXT_COOKIE, encodeContext(context), contextCookieOptions());
}
