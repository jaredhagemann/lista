import { NextResponse } from "next/server";
import { saveContextCookie } from "@/lib/active-context-save";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";

/**
 * POST /api/club/teams
 *
 * Creates a new team within an existing organization and automatically
 * enrolls all current org owners and directors as team members (role: director).
 * Restricted to org owners and directors.
 *
 * Body: { orgId: string; teamName: string; season?: string }
 */
export async function POST(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { orgId, teamName, season } = body as {
    orgId?: string;
    teamName?: string;
    season?: string;
  };

  if (!orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }
  if (!teamName?.trim()) {
    return NextResponse.json({ error: "teamName is required" }, { status: 400 });
  }

  const admin = adminClient();

  // Resolve the caller's profile
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
  }

  // Fetch all org members (owners + directors) in one query — we need the
  // full list both for the authorization check and for auto-enrollment.
  const { data: orgMembers } = await admin
    .from("organization_members")
    .select("profile_id, role")
    .eq("organization_id", orgId)
    .in("role", ["owner", "director"]);

  const callerMember = (orgMembers ?? []).find((m) => m.profile_id === profile.id);
  if (!callerMember) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Enforce the per-org team limit (spec: "Team Creation Limits"). The cap is
  // per-org, not per-user, so it cannot live in RLS — it is enforced here and
  // in the create_club_team RPC, which must agree. A NULL team_limit
  // (club_large) is unlimited and never blocks. Existing teams above the limit
  // (e.g. after a Large → Small downgrade) stay accessible; only creating an
  // additional team past the cap is rejected. Archived teams do NOT count —
  // spec's over-limit banner advises archiving as a remedy, so archiving must
  // actually free a slot. The RPC enforces the same active-only count.
  const { data: org } = await admin
    .from("organizations")
    .select("team_limit, closed_at")
    .eq("id", orgId)
    .single();

  // A closed club takes nothing new (BUG-013); the database refuses it too.
  if (org?.closed_at) {
    return NextResponse.json({ error: "This club is closed" }, { status: 409 });
  }

  if (org?.team_limit != null) {
    const { count } = await admin
      .from("teams")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("archived_at", null);

    if ((count ?? 0) >= org.team_limit) {
      return NextResponse.json(
        { error: `You've reached your plan limit of ${org.team_limit} teams.` },
        { status: 403 }
      );
    }
  }

  const teamId = crypto.randomUUID();

  // Create the team
  const { error: teamError } = await admin.from("teams").insert({
    id: teamId,
    organization_id: orgId,
    owner_id: profile.id,
    name: teamName.trim(),
    season: season?.trim() || null,
  });

  if (teamError) {
    return NextResponse.json({ error: teamError.message }, { status: 500 });
  }

  // Auto-enroll all org owners and directors as team members.
  // This gives them a roster row, team notifications, and chat access,
  // and ensures server-side role checks (which query team_members directly)
  // pass without requiring a separate org membership lookup. The database
  // enrolls whoever qualifies now: someone in orgMembers may have left since
  // (BUG-046).
  const { data: enrolled, error: memberError } = await admin.rpc("enroll_club_admins", {
    p_team_id: teamId,
  });

  // A team the creator isn't on is one they can't open, so it goes.
  if (memberError || !(enrolled ?? []).includes(profile.id)) {
    console.error("Failed to enroll the club's directors:", memberError?.message ?? "creator not enrolled");
    await admin.from("teams").delete().eq("id", teamId);
    return NextResponse.json(
      { error: "Couldn't add you to the new team. Please try again." },
      { status: 500 }
    );
  }

  // The new team is the creator's last-picked team (the default for their other
  // devices), and this browser lands on it, if they're on it
  // (device-local-active-context, D2, D5).
  await admin
    .from("profiles")
    .update({ active_team_id: teamId })
    .eq("id", profile.id);
  await saveContextCookie({ accountId: user.id, profileId: profile.id, teamId });

  return NextResponse.json({ ok: true, teamId }, { status: 201 });
}
