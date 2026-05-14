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
    { data: pendingInvites },
    { data: teamMemberProfiles },
  ] = await Promise.all([
    admin.from("profiles").select("first_name, last_name").eq("id", user.id).single(),
    inviteBranding(teamId),
    inviteBaseUrl(teamId),
    admin.from("teams").select("name").eq("id", teamId).single(),
    admin
      .from("invitations")
      .select("email, first_name, last_name, birthday")
      .eq("team_id", teamId)
      .is("accepted_at", null),
    admin
      .from("team_members")
      .select("profile_id, profiles(email, first_name, last_name, birthday)")
      .eq("team_id", teamId),
  ]);

  type ExistingPerson = { email: string | null; first_name: string | null; last_name: string | null; birthday: string | null };

  const existingPeople: ExistingPerson[] = [
    ...(pendingInvites ?? []),
    ...((teamMemberProfiles ?? []).map((m) => m.profiles as ExistingPerson | null).filter(Boolean) as ExistingPerson[]),
  ];

  // Build a profile_id → profile map so manager links can resolve player data
  const memberProfileMap = new Map<string, ExistingPerson>(
    (teamMemberProfiles ?? [])
      .filter((m) => m.profile_id && m.profiles)
      .map((m) => [m.profile_id as string, m.profiles as ExistingPerson])
  );
  const memberProfileIds = Array.from(memberProfileMap.keys());

  // Fetch managers of existing team members (second round-trip; depends on member IDs above)
  const { data: managerLinks } = memberProfileIds.length > 0
    ? await admin
        .from("profile_managers")
        .select("managed_id, profiles!profile_managers_manager_id_fkey(email)")
        .in("managed_id", memberProfileIds)
    : { data: [] as { managed_id: string; profiles: { email: string | null } | null }[] };

  // manager email (lowercase) → managed player profiles on this team
  const managerEmailToPlayers = new Map<string, ExistingPerson[]>();
  for (const link of managerLinks ?? []) {
    const mgr = link.profiles as { email: string | null } | null;
    if (!mgr?.email) continue;
    const key = mgr.email.toLowerCase();
    const player = memberProfileMap.get(link.managed_id);
    if (!player) continue;
    if (!managerEmailToPlayers.has(key)) managerEmailToPlayers.set(key, []);
    managerEmailToPlayers.get(key)!.push(player);
  }

  function isExistingDuplicate(row: BulkInputRow): boolean {
    const rowEmail = row.email.trim().toLowerCase();
    const rowFn = row.first_name.trim().toLowerCase();
    const rowLn = row.last_name.trim().toLowerCase();

    if (existingPeople.some((p) => {
      if (!p.email || !p.first_name) return false;
      if (p.email.toLowerCase() !== rowEmail) return false;
      if (p.first_name.toLowerCase() !== rowFn) return false;
      if ((p.last_name ?? "").toLowerCase() !== rowLn) return false;
      return row.birthday ? p.birthday === row.birthday : true;
    })) return true;

    // Also match via manager email: invite email = parent email, player name/birthday matches
    return (managerEmailToPlayers.get(rowEmail) ?? []).some((p) => {
      if ((p.first_name ?? "").toLowerCase() !== rowFn) return false;
      if ((p.last_name ?? "").toLowerCase() !== rowLn) return false;
      return row.birthday ? p.birthday === row.birthday : true;
    });
  }

  const teamName = team?.name ?? "your team";
  const inviterName =
    [inviterProfile?.first_name, inviterProfile?.last_name]
      .filter(Boolean)
      .join(" ") || "Your coach";

  // For each valid row: send first, then insert with determined email_status
  type RowResult = { id?: string; email: string; status: "sent" | "failed"; error?: string };
  type AlreadyExistsRow = { email: string; first_name: string; last_name: string };
  const results: RowResult[] = [];
  const alreadyExistsRows: AlreadyExistsRow[] = [];

  for (const row of validRows) {
    if (isExistingDuplicate(row)) {
      alreadyExistsRows.push({ email: row.email, first_name: row.first_name, last_name: row.last_name });
      continue;
    }
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
    already_exists: alreadyExistsRows.length,
    already_exists_rows: alreadyExistsRows,
    failed,
    results,
  });
}
