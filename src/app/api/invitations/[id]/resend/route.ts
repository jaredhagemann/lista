import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { sendEmail, buildInviteEmailHtml } from "@/lib/notifications/email";
import { invitationLimiter, rateLimitResponse } from "@/lib/rate-limit";
import type { Database } from "@/types/database";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await invitationLimiter.limit(user.id);
  if (!success) return rateLimitResponse();

  const admin = createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: invitation } = await admin
    .from("invitations")
    .select("*, teams(name)")
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
  const { data: membership } = await supabase
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
      subject: `You've been invited to join ${teamName} on lista`,
      html: buildInviteEmailHtml({
        teamName,
        role: invitation.role,
        inviteUrl,
      }),
    });
    emailSent = true;
  } catch (err) {
    console.error("Failed to resend invite email:", err);
  }

  return NextResponse.json({ success: true, emailSent });
}
