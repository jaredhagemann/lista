"use server";

import { createClient } from "@/lib/supabase/server";
import { loadActiveContext } from "@/lib/active-context";
import { saveContextCookie } from "@/lib/active-context-save";

/**
 * Saves the context the dashboard chose for a device that had none, or whose
 * saved team was no longer valid (spec D2, D3). A server component can't set a
 * cookie, so the page asks for it after rendering.
 *
 * The context is chosen again here, never taken from the caller: only what the
 * server itself would choose for this account is saved (D6). A read that fails
 * saves nothing.
 */
export async function saveActiveContext(profileId: string, teamId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { saved: false };

  const { save } = await loadActiveContext(supabase, user.id);
  if (!save || save.profileId !== profileId || save.teamId !== teamId) return { saved: false };

  await saveContextCookie(save);
  return { saved: true };
}
