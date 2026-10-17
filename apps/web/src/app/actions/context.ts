"use server";

import { createClient } from "@/lib/supabase/server";
import { loadActiveContext } from "@/lib/active-context";
import { saveContextCookie } from "@/lib/active-context-save";

/**
 * Saves the context the dashboard rendered for a device that had none, or whose
 * saved team was no longer valid (spec D2, D3). A server component can't set a
 * cookie, so the page asks for it after rendering.
 *
 * It saves what was rendered, not a fresh choice: another device may have
 * changed the shared default since, and that must not stop this device keeping
 * what it showed (review DC-001). It is still checked here, never trusted:
 *   - the person must be the account's own or managed, on that team (D6)
 *   - a valid context saved on this device since, by a switch, is kept
 *   - a read that fails saves nothing
 */
export async function saveActiveContext(profileId: string, teamId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { saved: false };

  const context = await loadActiveContext(supabase, user.id);
  if (context.failed || context.keptSaved || !context.allows(profileId, teamId)) return { saved: false };

  await saveContextCookie({ accountId: user.id, profileId, teamId });
  return { saved: true };
}
