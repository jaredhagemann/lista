import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { sendEmail, buildInviteEmailHtml } from "@/lib/notifications/email";
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

  // Verify caller is a team admin
  const { data: membership } = await admin
    .from("team_members")
    .select("role")
    .eq("team_id", invitation.team_id!)
    .eq("profile_id", user.id)
    .single();

  if (!membership || !["coach", "manager"].includes(membership.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const teamName =
    (invitation.teams as { name: string } | null)?.name ?? "your team";
  const inviterProfile = invitation.profiles as
    | { first_name: string | null; last_name: string | null }
    | null;
  const inviterName =
    [inviterProfile?.first_name, inviterProfile?.last_name]
      .filter(Boolean)
      .join(" ") || "Your coach";
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : "http://localhost:3000");
  const inviteUrl = `${appUrl}/invite/${id}`;

  let emailSent = false;
  try {
    await sendEmail({
      to: invitation.email,
      subject: `You've been invited to join ${teamName} on Lista`,
      html: buildInviteEmailHtml({ teamName, inviterName, role: invitation.role, inviteUrl }),
    });
    emailSent = true;
  } catch (err) {
    console.error("Failed to resend invite email:", err);
  }

  return NextResponse.json({ success: true, emailSent });
}
