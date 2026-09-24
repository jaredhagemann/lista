import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";

/**
 * Removes a club director (BUG-013).
 *
 * Only the club owner may, and never the owner themselves: ownership changes by
 * transfer. remove_org_director does it in one transaction — the directorship,
 * the director's place on every team it gave them, and their teams, which pass
 * to the owner. Any other role they hold on a team stays.
 */
export async function POST(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId, profileId } = (await request.json()) as { orgId?: string; profileId?: string };
  if (!orgId || !profileId) {
    return NextResponse.json({ error: "A club and a director are required" }, { status: 400 });
  }

  const { error } = await adminClient().rpc("remove_org_director", {
    p_actor_id: user.id,
    p_org_id: orgId,
    p_profile_id: profileId,
  });
  if (error) {
    if (error.message.includes("NOT_AUTHORIZED")) {
      return NextResponse.json({ error: "Only the club owner can remove directors" }, { status: 403 });
    }
    if (error.message.includes("NOT_A_DIRECTOR")) {
      return NextResponse.json({ error: "That person is not a director of this club" }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not remove the director" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
