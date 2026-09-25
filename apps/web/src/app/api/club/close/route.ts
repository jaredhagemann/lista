import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe";
import { invalidateTenantCache } from "@/lib/supabase/tenant";
import { clubRefusal } from "@/lib/club/errors";
import { sendEmail, buildClubNoticeEmailHtml, escapeHtml } from "@/lib/notifications/email";

/**
 * Closes a club (BUG-013, part 3; D7: archive, never erase).
 *
 * Decisions (2026-09-24): only the owner, confirming with the club's name; the
 * subscription is cancelled immediately with no refund; the club's history
 * stays readable, read-only, by its members; every member is told.
 *
 * Stripe goes first, after every check that can be made without it: a club is
 * never left closed while still billing. close_club then repeats the checks in
 * the transaction that closes the club.
 */

const BASE_DOMAIN = "lista.team";
// Statuses under which Stripe would still bill.
const BILLING = new Set(["active", "trialing", "past_due", "unpaid"]);

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function POST(request: Request) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId, confirmName } = (await request.json()) as { orgId?: string; confirmName?: string };
  if (!orgId || !confirmName?.trim()) {
    return NextResponse.json({ error: "A club and its name are required" }, { status: 400 });
  }

  const admin = adminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, subscription_status, stripe_subscription_id, subdomain, custom_domain, closed_at")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }

  const { data: owner } = await admin
    .from("organization_members")
    .select("profile_id")
    .eq("role", "owner")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (owner?.profile_id !== user.id) {
    return NextResponse.json({ error: "Only the club owner can close the club" }, { status: 403 });
  }
  if (org.closed_at) {
    return NextResponse.json({ error: "This club is already closed" }, { status: 409 });
  }
  if (!sameName(confirmName, org.name)) {
    return NextResponse.json({ error: "Type the club's name exactly to confirm" }, { status: 400 });
  }

  if (org.stripe_subscription_id && BILLING.has(org.subscription_status ?? "")) {
    try {
      // Now, with no proration credit and no final invoice: no refund.
      await getStripe().subscriptions.cancel(org.stripe_subscription_id, { prorate: false, invoice_now: false });
    } catch (err) {
      console.error("Failed to cancel the club's subscription:", err);
      return NextResponse.json(
        { error: "We couldn't cancel the club's subscription, so the club is still open. Please try again." },
        { status: 502 }
      );
    }
  }

  const { error } = await admin.rpc("close_club", {
    p_actor_id: user.id,
    p_org_id: orgId,
    p_confirm_name: confirmName,
  });
  if (error) return clubRefusal(error, "Could not close the club");

  // The released domains must stop resolving to the club.
  await Promise.allSettled(
    [org.subdomain && `${org.subdomain}.${BASE_DOMAIN}`, org.custom_domain]
      .filter((host): host is string => !!host)
      .map((host) => invalidateTenantCache(host))
  );

  const { data: members } = await admin.rpc("club_member_emails", { p_org_id: orgId });
  const clubName = escapeHtml(org.name);
  const results = await Promise.allSettled(
    ((members ?? []) as Array<{ email: string; first_name: string | null }>).map((member) =>
      sendEmail({
        to: member.email,
        subject: `${org.name} has closed`,
        html: buildClubNoticeEmailHtml({
          heading: `${clubName} has closed`,
          paragraphs: [
            `Hi ${escapeHtml(member.first_name || "there")},`,
            `<strong>${clubName}</strong> has been closed by its owner. Its teams, schedules and chat are still readable on Lista, but nothing new can be added.`,
          ],
          footer: `You received this email because you were a member of ${clubName} on Lista.`,
        }),
      })
    )
  );

  return NextResponse.json({
    success: true,
    notified: results.filter((r) => r.status === "fulfilled").length,
  });
}
