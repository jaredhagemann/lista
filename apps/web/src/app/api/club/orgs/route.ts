import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";

/**
 * GET /api/club/orgs
 *
 * Returns all club-plan organizations where the caller holds the owner role.
 * Used by the team creation dialog to let club owners add a new team to an
 * existing org rather than always creating a new one.
 *
 * Response: [{ id, name, orgNamePublic }]
 */
export async function GET(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = adminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
  }

  const { data: memberships } = await admin
    .from("organization_members")
    .select("organizations(id, name, org_name_public, plan)")
    .eq("profile_id", profile.id)
    .eq("role", "owner");

  const clubOrgs = (memberships ?? [])
    .map((m) => m.organizations as { id: string; name: string; org_name_public: string | null; plan: string | null } | null)
    .filter((org): org is NonNullable<typeof org> => org !== null && org.plan === "club")
    .map((org) => ({ id: org.id, name: org.name, orgNamePublic: org.org_name_public }));

  return NextResponse.json(clubOrgs);
}
