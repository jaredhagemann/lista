import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { clubRefusal } from "@/lib/club/errors";
import { sendTransferOffer } from "@/lib/club/ownership";

/**
 * Offers club ownership to a director (BUG-013, part 2).
 *
 * start_ownership_transfer allows only the owner, only to a director of the
 * club, and one pending transfer at a time; it expires after 14 days. Nothing
 * changes until the director accepts (POST /api/club/ownership/respond).
 */
export async function POST(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId, toProfileId } = (await request.json()) as { orgId?: string; toProfileId?: string };
  if (!orgId || !toProfileId) {
    return NextResponse.json({ error: "A club and a director are required" }, { status: 400 });
  }

  const admin = adminClient();
  const { data: transferId, error } = await admin.rpc("start_ownership_transfer", {
    p_actor_id: user.id,
    p_org_id: orgId,
    p_to_profile_id: toProfileId,
  });
  if (error) return clubRefusal(error, "Could not start the transfer");

  await sendTransferOffer(admin, { orgId, fromId: user.id, toId: toProfileId });

  return NextResponse.json({ success: true, transferId });
}
