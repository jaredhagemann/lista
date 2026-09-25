import type { adminClient } from "@/lib/api-auth";
import { applyOwnershipChange } from "@/lib/club/ownership";

/**
 * Support's recovery of a club whose owner has lost access (BUG-013, part 2).
 * Run through scripts/recover-club-ownership.ts, following
 * docs/runbooks/club-owner-recovery.md — never from a request.
 *
 * Decisions (2026-09-24): ownership goes to a current director who asked for it
 * and confirmed the club's Stripe billing details; there is no waiting period;
 * the previous owner's address is told at once, with how to object.
 */

type Admin = ReturnType<typeof adminClient>;

export async function recoverClubOwnership(
  admin: Admin,
  { orgId, toEmail, reason }: { orgId: string; toEmail: string; reason: string }
): Promise<{ transferId: string; previousOwnerId: string | null; billingEmailUpdated: boolean; noticeSent: boolean }> {
  if (!reason.trim()) {
    throw new Error("A reason is required: record how the request was verified.");
  }

  const email = toEmail.trim().toLowerCase();
  const { data: profile } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (!profile) {
    throw new Error(`${email} has no Lista account.`);
  }

  const { data, error } = await admin.rpc("recover_club_ownership", {
    p_org_id: orgId,
    p_to_profile_id: profile.id,
    p_reason: reason.trim(),
  });
  if (error) {
    throw new Error(error.message);
  }
  const { transfer_id: transferId, previous_owner_id: previousOwnerId } = data as {
    transfer_id: string;
    previous_owner_id: string | null;
  };

  const { billingEmailUpdated, noticeSent } = await applyOwnershipChange(admin, {
    orgId,
    newOwnerId: profile.id,
    previousOwnerId,
    how: "recovered",
  });

  return { transferId, previousOwnerId, billingEmailUpdated, noticeSent };
}
