import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { sendEmail, buildInviteEmailHtml } from "@/lib/notifications/email";
import { orgInviteBaseUrl, orgInviteBranding } from "@/lib/invitations/invite-base-url";
import { invitationLimiter, rateLimitResponse } from "@/lib/rate-limit";

/**
 * Invites someone to be a director of a club (BUG-013).
 *
 * Only the club owner may. create_director_invitation checks that, refuses an
 * existing owner or director, and hands back the pending invitation when the
 * address has one already, so asking again resends it. The recipient becomes a
 * director when they accept, through the same accept flow as every invitation.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await invitationLimiter.limit(user.id);
  if (!success) return rateLimitResponse();

  const { orgId, email: rawEmail } = (await request.json()) as { orgId?: string; email?: string };
  const email = rawEmail?.trim().toLowerCase() ?? "";
  if (!orgId || !EMAIL.test(email)) {
    return NextResponse.json({ error: "A club and a valid email address are required" }, { status: 400 });
  }

  const admin = adminClient();
  const { data, error } = await admin.rpc("create_director_invitation", {
    p_actor_id: user.id,
    p_org_id: orgId,
    p_email: email,
  });
  if (error) {
    if (error.message.includes("NOT_AUTHORIZED")) {
      return NextResponse.json({ error: "Only the club owner can invite directors" }, { status: 403 });
    }
    if (error.message.includes("ALREADY_MEMBER")) {
      return NextResponse.json({ error: "That person is already the owner or a director of this club" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create the invitation" }, { status: 500 });
  }
  const { invitation_id: invitationId, resent } = data as { invitation_id: string; resent: boolean };

  const [{ data: org }, { data: inviter }, { brandName, logoUrl }, baseUrl] = await Promise.all([
    admin.from("organizations").select("name").eq("id", orgId).single(),
    admin.from("profiles").select("first_name, last_name").eq("id", user.id).single(),
    orgInviteBranding(orgId),
    orgInviteBaseUrl(orgId),
  ]);
  const clubName = org?.name ?? "your club";
  const inviterName = [inviter?.first_name, inviter?.last_name].filter(Boolean).join(" ") || "The club owner";
  const inviteUrl = `${baseUrl}/invite/${invitationId}`;

  let emailSent = false;
  try {
    await sendEmail({
      to: email,
      subject: `You've been invited to help run ${clubName} on ${brandName ?? "Lista"}`,
      html: buildInviteEmailHtml({
        teamName: clubName,
        inviterName,
        role: "director",
        inviteUrl,
        brandName,
        logoUrl,
        kind: "club",
      }),
      brandName,
    });
    emailSent = true;
  } catch (err) {
    console.error("Failed to send director invite email:", err);
  }

  await admin
    .from("invitations")
    .update({ email_status: emailSent ? "sent" : "failed" })
    .eq("id", invitationId);

  return NextResponse.json({ success: true, resent, emailSent, inviteUrl });
}
