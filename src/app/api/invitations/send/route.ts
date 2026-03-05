import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, buildInviteEmailHtml } from "@/lib/notifications/email";
import type { Database } from "@/types/database";
import { invitationLimiter, rateLimitResponse } from "@/lib/rate-limit";

type InvitationRole = Database["public"]["Tables"]["invitations"]["Row"]["role"];

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await invitationLimiter.limit(user.id);
  if (!success) return rateLimitResponse();

  const body = await request.json();
  const { teamId, email, role, firstName, lastName } = body as {
    teamId: string;
    email: string;
    role: InvitationRole;
    firstName?: string;
    lastName?: string;
  };

  if (!teamId || !email || !role) {
    return NextResponse.json(
      { error: "teamId, email, and role are required" },
      { status: 400 }
    );
  }

  // Verify caller is a team admin (coach or manager)
  const { data: membership } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("profile_id", user.id)
    .single();

  if (!membership || !["coach", "manager"].includes(membership.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Generate invitation ID client-side to avoid SELECT RLS issue
  const invitationId = crypto.randomUUID();

  const { error: insertError } = await supabase.from("invitations").insert({
    id: invitationId,
    team_id: teamId,
    email,
    role,
    first_name: firstName || null,
    last_name: lastName || null,
    invited_by: user.id,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Fetch team name for the email
  const { data: team } = await supabase
    .from("teams")
    .select("name")
    .eq("id", teamId)
    .single();

  const teamName = team?.name ?? "your team";
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : "http://localhost:3000");
  const inviteUrl = `${appUrl}/invite/${invitationId}`;

  let emailSent = false;
  try {
    await sendEmail({
      to: email,
      subject: `You've been invited to join ${teamName} on lista`,
      html: buildInviteEmailHtml({ teamName, role, inviteUrl }),
    });
    emailSent = true;
  } catch (err) {
    console.error("Failed to send invite email:", err);
  }

  return NextResponse.json({ success: true, emailSent, inviteUrl });
}
