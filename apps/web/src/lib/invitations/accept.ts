import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Invitation acceptance, shared by the web server actions and
 * POST /api/invite/[id]/accept (BUG-012).
 *
 * All checks and writes happen in the `accept_invitation` database function, in
 * one transaction with the invitation row locked:
 *   - the signed-in user must be the recipient (email, case-insensitive)
 *   - the mode must match the invitation's kind:
 *       guardian invitation (managed_profile_id set) → "manager"
 *       player invitation                            → "self" or "guardian"
 *       coach / manager invitation                   → "self"
 *   - it succeeds once; concurrent or repeated acceptances are refused
 *
 * Callers must pass the id of the authenticated user, never an id from the
 * request, and must use a service-role client (the function is not executable
 * by client roles).
 */

export type AcceptMode = "self" | "guardian" | "manager";

export type AcceptFailure =
  | "not_found"
  | "already_accepted"
  | "wrong_recipient"
  | "wrong_type"
  | "not_your_child"
  | "failed";

export type AcceptResult =
  | {
      ok: true;
      teamId: string | null;
      teamMemberId: string | null;
      managedProfileId: string | null;
    }
  | { ok: false; reason: AcceptFailure; message: string };

const FAILURE_MARKERS: Array<[string, AcceptFailure]> = [
  ["NOT_YOUR_MANAGED_PROFILE", "not_your_child"],
  ["INVITATION_NOT_FOUND", "not_found"],
  ["INVITATION_ALREADY_ACCEPTED", "already_accepted"],
  ["INVITATION_WRONG_RECIPIENT", "wrong_recipient"],
  ["INVITATION_WRONG_TYPE", "wrong_type"],
];

/** User-facing message for each failure, matching the wording the flows already used. */
export const ACCEPT_FAILURE_MESSAGES: Record<Exclude<AcceptFailure, "failed">, string> = {
  not_found: "Invitation not found",
  already_accepted: "Invitation already accepted",
  wrong_recipient: "This invitation was sent to a different email address",
  wrong_type: "Invalid invitation type",
  not_your_child: "You don't manage that player",
};

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function acceptInvitation(
  admin: SupabaseClient<Database>,
  params: {
    invitationId: string;
    userId: string;
    mode: AcceptMode;
    relationship?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    /**
     * Guardian mode only: a child the caller already manages, joined to the team
     * instead of a new profile being minted (BUG-011). The database checks that
     * the caller really manages them.
     */
    managedProfileId?: string | null;
  }
): Promise<AcceptResult> {
  const { data, error } = await admin.rpc("accept_invitation", {
    p_invitation_id: params.invitationId,
    p_user_id: params.userId,
    p_mode: params.mode,
    p_relationship: params.relationship ?? undefined,
    p_first_name: params.firstName ?? undefined,
    p_last_name: params.lastName ?? undefined,
    p_managed_profile_id: params.managedProfileId ?? undefined,
  });

  if (error) {
    // A malformed id can't name an invitation (invalid_text_representation).
    if (error.code === "22P02") {
      return { ok: false, reason: "not_found", message: ACCEPT_FAILURE_MESSAGES.not_found };
    }
    const match = FAILURE_MARKERS.find(([marker]) => error.message.includes(marker));
    if (match) {
      const reason = match[1] as Exclude<AcceptFailure, "failed">;
      return { ok: false, reason, message: ACCEPT_FAILURE_MESSAGES[reason] };
    }
    return { ok: false, reason: "failed", message: error.message };
  }

  const result = (data ?? {}) as {
    team_id?: string | null;
    team_member_id?: string | null;
    managed_profile_id?: string | null;
  };
  return {
    ok: true,
    teamId: result.team_id ?? null,
    teamMemberId: result.team_member_id ?? null,
    managedProfileId: result.managed_profile_id ?? null,
  };
}
