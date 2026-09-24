/**
 * Moves a club's ownership to one of its directors when the owner has lost
 * access (BUG-013). Support only — follow docs/runbooks/club-owner-recovery.md,
 * which says what must be verified first.
 *
 *   pnpm exec tsx --env-file=<env file> scripts/recover-club-ownership.ts \
 *     --org <organization id> --to <director's email> --reason "<how it was verified>" [--yes]
 *
 * Without --yes it only shows what would change. The env file needs
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the database, and
 * STRIPE_SECRET_KEY and RESEND_API_KEY for billing and the notice email.
 */

import { adminClient } from "@/lib/api-auth";
import { recoverClubOwnership } from "@/lib/club/recovery";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgId = arg("org");
  const toEmail = arg("to");
  const reason = arg("reason");
  const confirmed = process.argv.includes("--yes");
  if (!orgId || !toEmail || !reason) {
    console.error('Usage: --org <organization id> --to <director email> --reason "<how it was verified>" [--yes]');
    process.exit(2);
  }

  const admin = adminClient();
  const { data: org } = await admin.from("organizations").select("name, closed_at").eq("id", orgId).maybeSingle();
  if (!org) {
    console.error(`No club with id ${orgId}.`);
    process.exit(1);
  }
  const { data: members } = await admin
    .from("organization_members")
    .select("role, profiles(email, first_name, last_name)")
    .eq("organization_id", orgId);

  console.log(`Club: ${org.name}${org.closed_at ? " (closed)" : ""}`);
  for (const m of members ?? []) {
    const p = m.profiles as { email: string | null; first_name: string | null; last_name: string | null } | null;
    console.log(`  ${m.role.padEnd(8)} ${[p?.first_name, p?.last_name].filter(Boolean).join(" ")} <${p?.email}>`);
  }
  console.log(`New owner: ${toEmail}`);
  console.log(`Reason: ${reason}`);

  if (!confirmed) {
    console.log("\nDry run: nothing changed. Re-run with --yes to transfer ownership.");
    return;
  }

  const result = await recoverClubOwnership(admin, { orgId, toEmail, reason });
  console.log(`\nDone. Transfer ${result.transferId} recorded.`);
  console.log(
    result.noticeSent
      ? "Notice sent to the previous owner's address."
      : "Notice NOT sent (no previous owner, or the email failed): tell them another way, as the runbook says."
  );
  console.log(
    result.billingEmailUpdated
      ? "Stripe billing email moved to the new owner."
      : "Stripe billing email NOT updated (no customer, or Stripe failed): update it in the Stripe dashboard."
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
