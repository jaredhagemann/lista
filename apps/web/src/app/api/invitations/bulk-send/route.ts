import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient, assertTeamAdmin } from "@/lib/api-auth";
import { sendEmail, buildInviteEmailHtml } from "@/lib/notifications/email";
import { inviteBaseUrl, inviteBranding } from "@/lib/invitations/invite-base-url";
import { bulkInvitationLimiter, rateLimitResponse } from "@/lib/rate-limit";
import { validateBulkRows } from "@/lib/invitations/bulk-validate";
import type { BulkInputRow } from "@/lib/invitations/bulk-validate";
import type { Database } from "@/types/database";

type InvitationRole = Database["public"]["Tables"]["invitations"]["Row"]["role"];

const MAX_ROWS = 100;

export async function POST(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await bulkInvitationLimiter.limit(user.id);
  if (!success) return rateLimitResponse();

  const body = await request.json();
  const { teamId, rows } = body as { teamId: string; rows: BulkInputRow[] };

  if (!teamId || !Array.isArray(rows)) {
    return NextResponse.json(
      { error: "teamId and rows are required" },
      { status: 400 }
    );
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_ROWS} rows per upload` },
      { status: 400 }
    );
  }

  const admin = adminClient();
  const isTeamAdmin = await assertTeamAdmin(admin, user.id, teamId);
  if (!isTeamAdmin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Server-side re-validation mirrors client-side rules
  const validated = validateBulkRows(rows);
  const validRows = validated.filter((r) => r.status === "valid");
  const skippedCount = validated.filter((r) => r.status === "warning").length;
  const serverErrorCount = validated.filter((r) => r.status === "error").length;

  // Resolve shared context once for all rows
  const [
    { data: inviterProfile },
    { brandName, logoUrl },
    baseUrl,
    { data: team },
  ] = await Promise.all([
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

  // For each valid row: send first, then insert with determined email_status
  type RowResult = { id?: string; email: string; status: "sent" | "failed"; error?: string };
  const results: RowResult[] = [];

  for (const row of validRows) {
    const invitationId = crypto.randomUUID();
    const inviteUrl = `${baseUrl}/invite/${invitationId}`;
    const role = row.role.toLowerCase() as InvitationRole;

    let emailSent = false;
    try {
      await sendEmail({
        to: row.email.trim(),
        subject: `You've been invited to join ${teamName} on ${brandName ?? "Lista"}`,
        html: buildInviteEmailHtml({
          teamName,
          inviterName,
          role,
          inviteUrl,
          brandName,
          logoUrl,
        }),
        brandName,
      });
      emailSent = true;
    } catch (err) {
      console.error("Failed to send bulk invite email:", err);
    }

    const { error: insertError } = await admin.from("invitations").insert({
      id: invitationId,
      team_id: teamId,
      email: row.email.trim(),
      role,
      first_name: row.first_name.trim(),
      last_name: row.last_name.trim(),
      birthday: row.birthday || null,
      gender: row.gender || null,
      invited_by: user.id,
      email_status: emailSent ? "sent" : "failed",
    });

    if (insertError) {
      results.push({ email: row.email, status: "failed", error: insertError.message });
    } else {
      results.push({
        id: invitationId,
        email: row.email,
        status: emailSent ? "sent" : "failed",
        error: emailSent ? undefined : "Email delivery failed",
      });
    }
  }

  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return NextResponse.json({
    success: true,
    sent,
    skipped: skippedCount + serverErrorCount,
    failed,
    results,
  });
}
