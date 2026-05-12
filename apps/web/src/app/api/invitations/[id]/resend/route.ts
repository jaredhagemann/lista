import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient, assertTeamAdmin } from "@/lib/api-auth";
import { sendEmail, buildInviteEmailHtml } from "@/lib/notifications/email";
import { inviteBaseUrl, inviteBranding } from "@/lib/invitations/invite-base-url";
import { invitationLimiter, rateLimitResponse } from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await resolveRequestUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await invitationLimiter.limit(user.id);
  if (!success) return rateLimitResponse();

  const admin = adminClient();

  const { data: invitation } = await admin
    .from("invitations")
    .select("*, teams(name), profiles!invitations_invited_by_fkey(first_name, last_name)")
    .eq("id", id)
    .single();

  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  if (invitation.accepted_at) {
    return NextResponse.json(
      { error: "Invitation already accepted" },
      { status: 400 }
    );
  }

  // Verify caller is a team admin (explicit row or org-level director/owner)
  const isTeamAdmin = await assertTeamAdmin(admin, user.id, invitation.team_id!);
  if (!isTeamAdmin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const teamId = invitation.team_id!;
  const teamName =
    (invitation.teams as { name: string } | null)?.name ?? "your team";
  const inviterProfile = invitation.profiles as
    | { first_name: string | null; last_name: string | null }
    | null;
  const inviterName =
    [inviterProfile?.first_name, inviterProfile?.last_name]
      .filter(Boolean)
      .join(" ") || "Your coach";

  // Resolve branding and invite URL from the team's org (not the request host)
  const [{ brandName, logoUrl }, baseUrl] = await Promise.all([
    inviteBranding(teamId),
    inviteBaseUrl(teamId),
  ]);

  const inviteUrl = `${baseUrl}/invite/${id}`;

  let emailSent = false;
  try {
    await sendEmail({
      to: invitation.email,
      subject: `You've been invited to join ${teamName} on ${brandName ?? "Lista"}`,
      html: buildInviteEmailHtml({ teamName, inviterName, role: invitation.role, inviteUrl, brandName, logoUrl }),
      brandName,
    });
    emailSent = true;
  } catch (err) {
    console.error("Failed to resend invite email:", err);
  }

  // Best-effort status update — if this fails, email_status stays at its prior value
  try {
    await admin
      .from("invitations")
      .update({ email_status: emailSent ? "sent" : "failed" })
      .eq("id", id);
  } catch {}

  return NextResponse.json({ success: true, emailSent });
}
