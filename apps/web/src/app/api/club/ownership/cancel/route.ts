import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { clubRefusal } from "@/lib/club/errors";

/** Withdraws a pending ownership offer; only the owner may (BUG-013, part 2). */
export async function POST(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { transferId } = (await request.json()) as { transferId?: string };
  if (!transferId) {
    return NextResponse.json({ error: "A transfer is required" }, { status: 400 });
  }

  const { error } = await adminClient().rpc("cancel_ownership_transfer", {
    p_actor_id: user.id,
    p_transfer_id: transferId,
  });
  if (error) return clubRefusal(error, "Could not cancel the transfer");

  return NextResponse.json({ success: true });
}
