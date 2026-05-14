import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient, assertTeamAdmin } from "@/lib/api-auth";
import { sendEmail, buildInviteEmailHtml } from "@/lib/notifications/email";
import { inviteBaseUrl, inviteBranding } from "@/lib/invitations/invite-base-url";
import type { Database } from "@/types/database";
import { invitationLimiter, rateLimitResponse } from "@/lib/rate-limit";

type InvitationRole = Database["public"]["Tables"]["invitations"]["Row"]["role"];

export async function POST(request: Request) {
  const user = await resolveRequestUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await invitationLimiter.limit(user.id);
  if (!success) return rateLimitResponse();

  const body = await request.json();
  const {
    teamId,
    email,
    role,
    firstName,
    lastName,
    birthday,
    gender,
    managedProfileId,
    relationship,
  } = body as {
    teamId: string;
    email: string;
    role: InvitationRole;
    firstName?: string;
    lastName?: string;
    birthday?: string;
    gender?: string;
    managedProfileId?: string;
    relationship?: string;
  };

  if (!teamId || !email || !role) {
    return NextResponse.json(
      { error: "teamId, email, and role are required" },
      { status: 400 }
    );
  }

  const admin = adminClient();

  // Verify caller is a team admin OR a profile manager for the managed profile
  const isTeamAdmin = await assertTeamAdmin(admin, user.id, teamId);

  if (!isTeamAdmin) {
    // Allow if they manage the specific profile being invited for
    if (!managedProfileId) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    const { data: managerLink } = await admin
      .from("profile_managers")
      .select("id")
      .eq("manager_id", user.id)
      .eq("managed_id", managedProfileId)
      .maybeSingle();

    if (!managerLink) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }

  // Check for an existing pending invitation or team member with the same details.
  // Uses email only (no name filter) for the profiles query so the same results
  // can serve both the direct-player check and the manager-email check.
  const [{ data: dupInvites }, { data: emailProfiles }] = await Promise.all([
    admin
      .from("invitations")
      .select("birthday")
      .eq("team_id", teamId)
      .is("accepted_at", null)
      .ilike("email", email)
      .ilike("first_name", firstName ?? "")
      .ilike("last_name", lastName ?? ""),
    admin
      .from("profiles")
      .select("id, first_name, last_name, birthday")
      .ilike("email", email),
  ]);

  const pendingDuplicate = (dupInvites ?? []).some(
    (inv) => birthday ? inv.birthday === birthday : true
  );

  // Profiles whose email AND name/birthday match — potential direct player duplicates
  const directMatchIds = (emailProfiles ?? [])
    .filter((p) =>
      (p.first_name ?? "").toLowerCase() === (firstName ?? "").toLowerCase() &&
      (p.last_name ?? "").toLowerCase() === (lastName ?? "").toLowerCase() &&
      (birthday ? p.birthday === birthday : true)
    )
    .map((p) => p.id);

  const allEmailProfileIds = (emailProfiles ?? []).map((p) => p.id);

  // Run direct member check and manager-link traversal in parallel
  const [directMemberResult, managerLinksResult] = await Promise.all([
    directMatchIds.length > 0
      ? admin.from("team_members").select("id").eq("team_id", teamId).in("profile_id", directMatchIds).limit(1)
      : Promise.resolve({ data: [] as { id: string }[] }),
    allEmailProfileIds.length > 0
      ? admin.from("profile_managers").select("managed_id").in("manager_id", allEmailProfileIds)
      : Promise.resolve({ data: [] as { managed_id: string }[] }),
  ]);

  const memberDuplicate = (directMemberResult.data?.length ?? 0) > 0;

  // Check whether the invite email belongs to a manager of an existing team member
  // whose name and birthday also match — catches invites sent via a parent's email.
  let managedMemberDuplicate = false;
  const managedIds = (managerLinksResult.data ?? []).map((r) => r.managed_id);
  if (!memberDuplicate && managedIds.length > 0) {
    let playerQuery = admin
      .from("profiles")
      .select("id")
      .in("id", managedIds)
      .ilike("first_name", firstName ?? "")
      .ilike("last_name", lastName ?? "");
    if (birthday) playerQuery = playerQuery.eq("birthday", birthday);
    const { data: matchingManagedPlayers } = await playerQuery;
    const matchingIds = (matchingManagedPlayers ?? []).map((p) => p.id);
    if (matchingIds.length > 0) {
      const { data: managedMemberRows } = await admin
        .from("team_members")
        .select("id")
        .eq("team_id", teamId)
        .in("profile_id", matchingIds)
        .limit(1);
      managedMemberDuplicate = (managedMemberRows?.length ?? 0) > 0;
    }
  }

  if (pendingDuplicate || memberDuplicate || managedMemberDuplicate) {
    return NextResponse.json(
      { error: "This person already has a pending invitation or is already a member of this team." },
      { status: 409 }
    );
  }

  // Generate UUID first — the invite URL is knowable before the row exists
  const invitationId = crypto.randomUUID();

  // Resolve branding and invite URL from the team's org (not the request host)
  const [{ data: inviterProfile }, { brandName, logoUrl }, baseUrl, { data: team }] =
    await Promise.all([
      admin.from("profiles").select("first_name, last_name").eq("id", user.id).single(),
      inviteBranding(teamId),
      inviteBaseUrl(teamId),
      admin.from("teams").select("name").eq("id", teamId).single(),
    ]);

  const teamName = team?.name ?? "your team";
  const inviterName =
    [inviterProfile?.first_name, inviterProfile?.last_name]
      .filter(Boolean)
      .join(" ") || "Your coach";
  const inviteUrl = `${baseUrl}/invite/${invitationId}`;

  // Attempt send before insert so email_status is determined at insert time
  let emailSent = false;
  try {
    await sendEmail({
      to: email,
      subject: `You've been invited to join ${teamName} on ${brandName ?? "Lista"}`,
      html: buildInviteEmailHtml({ teamName, inviterName, role, inviteUrl, brandName, logoUrl }),
      brandName,
    });
    emailSent = true;
  } catch (err) {
    console.error("Failed to send invite email:", err);
  }

  const { error: insertError } = await admin.from("invitations").insert({
    id: invitationId,
    team_id: teamId,
    email,
    role,
    first_name: firstName || null,
    last_name: lastName || null,
    birthday: birthday || null,
    gender: gender || null,
    managed_profile_id: managedProfileId || null,
    relationship: relationship || null,
    invited_by: user.id,
    email_status: emailSent ? "sent" : "failed",
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, emailSent, inviteUrl });
}
