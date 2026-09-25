import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { clubRefusal } from "@/lib/club/errors";
import { applyOwnershipChange, sendTransferDeclined } from "@/lib/club/ownership";

/**
 * The director accepts or declines an ownership offer (BUG-013, part 2).
 *
 * respond_ownership_transfer allows only the recipient, once, before expiry,
 * and only while both people still hold the roles the offer was made between.
 * On acceptance the previous owner becomes a director; Stripe's billing email
 * then follows the ownership, which a Stripe failure does not undo.
 */
export async function POST(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { transferId, accept } = (await request.json()) as { transferId?: string; accept?: unknown };
  if (!transferId || typeof accept !== "boolean") {
    return NextResponse.json({ error: "A transfer and an accept or decline are required" }, { status: 400 });
  }

  const admin = adminClient();
  const { data, error } = await admin.rpc("respond_ownership_transfer", {
    p_actor_id: user.id,
    p_transfer_id: transferId,
    p_accept: accept,
  });
  if (error) return clubRefusal(error, "Could not respond to the transfer");

  const result = data as {
    organization_id: string;
    from_profile_id: string;
    to_profile_id: string;
    accepted: boolean;
  };

  if (!result.accepted) {
    await sendTransferDeclined(admin, {
      orgId: result.organization_id,
      fromId: result.from_profile_id,
      toId: result.to_profile_id,
    });
    return NextResponse.json({ success: true, accepted: false });
  }

  const { billingEmailUpdated } = await applyOwnershipChange(admin, {
    orgId: result.organization_id,
    newOwnerId: result.to_profile_id,
    previousOwnerId: result.from_profile_id,
    how: "accepted",
  });
  return NextResponse.json({ success: true, accepted: true, billingEmailUpdated });
}
