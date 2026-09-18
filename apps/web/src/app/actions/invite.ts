"use server";

import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";
import { acceptInvitation } from "@/lib/invitations/accept";
import { ACTIVE_PROFILE_COOKIE } from "./constants";

// These actions are callable directly from the browser, so every check lives in
// acceptInvitation (the accept_invitation database function), not in the invite
// page: recipient, invitation kind, and one-time acceptance (BUG-012).

function adminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Accept an invitation as the currently signed-in user (their own account).
 * Used for manager/coach invites, and for player invites where the person
 * confirms they are the invited player.
 */
export async function acceptInvitationAsSelf(invitationId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const result = await acceptInvitation(adminClient(), {
    invitationId,
    userId: user.id,
    mode: "self",
  });
  if (!result.ok) return { error: result.message };

  revalidatePath("/dashboard", "layout");
  return { success: true, memberId: result.teamMemberId };
}

/**
 * Accept a player invitation as a parent/guardian.
 *
 * Creates a managed profile for the player and links the current user as their
 * manager — unless `managedProfileId` names a child they already manage, in
 * which case that child joins the team and keeps their one identity (BUG-011).
 */
export async function acceptInvitationAsGuardian(
  invitationId: string,
  {
    relationship,
    firstName,
    lastName,
    managedProfileId,
  }: {
    relationship: string;
    firstName?: string;
    lastName?: string;
    /** A child the guardian already manages, rather than a new one (BUG-011). */
    managedProfileId?: string;
  }
) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const result = await acceptInvitation(adminClient(), {
    invitationId,
    userId: user.id,
    mode: "guardian",
    relationship,
    firstName,
    lastName,
    managedProfileId,
  });
  if (!result.ok) return { error: result.message };

  revalidatePath("/dashboard", "layout");
  return { success: true, memberId: result.teamMemberId };
}

/**
 * Accept a "manage existing player" invitation.
 * Creates a profile_managers link between the current user and the
 * invitation's managed_profile_id. Sets the active profile cookie so the
 * user immediately views the dashboard as the managed player.
 */
export async function acceptManagerInvitation(invitationId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const result = await acceptInvitation(adminClient(), {
    invitationId,
    userId: user.id,
    mode: "manager",
  });
  if (!result.ok) return { error: result.message };

  // Switch the session to view as the managed player so the dashboard works.
  // Use a long-lived cookie (1 year) so it survives browser restarts — a parent
  // with no direct team membership has no meaningful "self" view anyway.
  if (result.managedProfileId) {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_PROFILE_COOKIE, result.managedProfileId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  revalidatePath("/dashboard", "layout");
  return { success: true };
}
