import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
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
  const { data: membership } = await admin
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("profile_id", user.id)
    .single();

  const isTeamAdmin =
    membership && ["coach", "manager"].includes(membership.role);

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

  // Generate invitation ID client-side to avoid SELECT RLS issue
  const invitationId = crypto.randomUUID();

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
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Resolve branding and invite URL from the team's org (not the request host)
  const [{ data: inviterProfile }, { brandName, logoUrl }, baseUrl] =
    await Promise.all([
      admin
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", user.id)
        .single(),
      inviteBranding(teamId),
      inviteBaseUrl(teamId),
    ]);

  // Fetch team name (already needed for email; org lookup happens inside helpers above)
  const { data: team } = await admin
    .from("teams")
    .select("name")
    .eq("id", teamId)
    .single();

  const teamName = team?.name ?? "your team";
  const inviterName =
    [inviterProfile?.first_name, inviterProfile?.last_name]
      .filter(Boolean)
      .join(" ") || "Your coach";
  const inviteUrl = `${baseUrl}/invite/${invitationId}`;

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

  return NextResponse.json({ success: true, emailSent, inviteUrl });
}
