import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";

/**
 * Returns the 409/500 response that blocks deleting this account, or null when
 * deletion may proceed.
 *
 *   - owns_teams: team ownership must be transferred first.
 *   - sole_guardian: a player with no login of their own would be left without
 *     any guardian who can sign in (D1/D7, BUG-002). The database refuses that
 *     deletion anyway; checking here lets us explain which players are affected.
 */
async function deletionBlocker(userId: string): Promise<NextResponse | null> {
  const admin = adminClient();

  const { data: ownedTeams, error: teamsError } = await admin
    .from("teams")
    .select("name")
    .eq("owner_id", userId);
  if (teamsError) {
    return NextResponse.json({ error: "deletion_failed" }, { status: 500 });
  }
  if (ownedTeams.length > 0) {
    return NextResponse.json(
      { error: "owns_teams", teams: ownedTeams.map((t) => t.name) },
      { status: 409 }
    );
  }

  const { data: dependents, error: dependentsError } = await admin.rpc(
    "guardian_dependents",
    { p_manager_id: userId }
  );
  if (dependentsError) {
    return NextResponse.json({ error: "deletion_failed" }, { status: 500 });
  }
  if (dependents.length > 0) {
    return NextResponse.json(
      {
        error: "sole_guardian",
        players: dependents.map((p) => [p.first_name, p.last_name].filter(Boolean).join(" ")),
      },
      { status: 409 }
    );
  }

  return null;
}

export async function GET(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const blocker = await deletionBlocker(user.id);
  if (blocker) return blocker;

  return NextResponse.json({ eligible: true });
}

export async function DELETE(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Re-check to guard against changes between the eligibility check and confirmation
  const blocker = await deletionBlocker(user.id);
  if (blocker) return blocker;

  const admin = adminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);

  if (error) {
    return NextResponse.json({ error: "deletion_failed" }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
