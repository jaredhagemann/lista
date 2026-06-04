import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  sendEmail,
  buildTrialReminderEmailHtml,
  buildTrialConvertedEmailHtml,
  buildTrialDowngradedEmailHtml,
  buildPaymentSucceededEmailHtml,
  buildPaymentFailedEmailHtml,
  buildSubscriptionCancelledEmailHtml,
  trialConvertedSubject,
  paymentFailedSubject,
  PAYMENT_SUCCEEDED_SUBJECT,
  TRIAL_DOWNGRADED_SUBJECT,
  SUBSCRIPTION_CANCELLED_SUBJECT,
  type ClubTier,
} from "@/lib/notifications/email";

/**
 * Resolve-owner-and-send helpers for the club-billing email triggers in
 * docs/specs/club-upgrade-monetization.md → "Email Notifications".
 *
 * Why this file exists separately from email.ts:
 *  - email.ts owns pure HTML builders + subjects (testable without I/O)
 *  - this file owns the orchestration that ties an org/subscription event to
 *    the right owner email and template (testable with a mocked sendEmail +
 *    Supabase client)
 *
 * Every helper resolves the owner via `organization_members.role = 'owner'`
 * joined to `profiles(email)`. If no owner email can be found the helper
 * returns false and writes nothing — sends are best-effort because a partial
 * failure must not block the surrounding cron/webhook DB writes (those are
 * the load-bearing state mutations; the email is recoverable from the
 * billing page).
 */

type Admin = SupabaseClient<Database>;

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function billingUrl(): string {
  return `${appUrl()}/dashboard/club/billing`;
}

function upgradeUrl(): string {
  return `${appUrl()}/dashboard/settings?tab=plan`;
}

interface OwnerLookup {
  email: string;
  orgName: string;
}

async function lookupOwnerByOrgId(
  admin: Admin,
  orgId: string,
  precomputed?: { name?: string | null },
): Promise<OwnerLookup | null> {
  const { data: member } = await admin
    .from("organization_members")
    .select("profiles(email)")
    .eq("organization_id", orgId)
    .eq("role", "owner")
    .maybeSingle();
  const email =
    (member as { profiles?: { email?: string | null } | null } | null)
      ?.profiles?.email ?? null;
  if (!email) return null;

  if (precomputed?.name) {
    return { email, orgName: precomputed.name };
  }
  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  const orgName = org?.name ?? "your club";
  return { email, orgName };
}

async function lookupOwnerBySubscriptionId(
  admin: Admin,
  subscriptionId: string,
): Promise<(OwnerLookup & { orgId: string }) | null> {
  const { data: org } = await admin
    .from("organizations")
    .select("id, name")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (!org?.id) return null;
  const owner = await lookupOwnerByOrgId(admin, org.id, { name: org.name });
  if (!owner) return null;
  return { ...owner, orgId: org.id };
}

/**
 * Wrap a send-call so an upstream caller (cron, webhook) can fire-and-forget
 * without a try/catch and without ever failing the surrounding handler. The
 * spec's idempotency model for emails is "best effort + at-least-once where
 * a sent-at column is present"; transient Resend errors are logged but never
 * raised back to the caller's I/O loop.
 */
async function safeSend(args: {
  to: string;
  subject: string;
  html: string;
  context: string;
}): Promise<boolean> {
  try {
    await sendEmail({ to: args.to, subject: args.subject, html: args.html });
    return true;
  } catch (err) {
    console.error(`Email send failed (${args.context}):`, err);
    return false;
  }
}

/**
 * Trial reminder (30 / 7 / 1 day). Caller supplies the subject because the
 * cron's window selection already chose which tier of reminder to send and
 * keeps the sent-at write next to the send call.
 *
 * Throws on send failure — the cron uses the thrown error to decide whether
 * to write the sent-at column (load-bearing: a NULL column means "retry next
 * run"). Do NOT swap this for safeSend without rewiring the cron.
 */
export async function sendTrialReminderEmail(args: {
  to: string;
  orgName: string;
  subject: string;
  trialEndsAt: string | null;
}): Promise<void> {
  await sendEmail({
    to: args.to,
    subject: args.subject,
    html: buildTrialReminderEmailHtml({
      orgName: args.orgName,
      subject: args.subject,
      trialEndsAt: args.trialEndsAt,
      manageBillingUrl: billingUrl(),
    }),
  });
}

/** Trial converted (cron created a paid Stripe subscription on day 91). */
export async function sendTrialConvertedEmail(
  admin: Admin,
  orgId: string,
  tier: ClubTier,
  orgName?: string,
): Promise<boolean> {
  const owner = await lookupOwnerByOrgId(admin, orgId, { name: orgName });
  if (!owner) return false;
  return safeSend({
    to: owner.email,
    subject: trialConvertedSubject(tier),
    html: buildTrialConvertedEmailHtml({
      orgName: owner.orgName,
      tier,
      manageBillingUrl: billingUrl(),
    }),
    context: `trial-converted org=${orgId}`,
  });
}

/** Trial downgraded (cron found no payment method on day 91). */
export async function sendTrialDowngradedEmail(
  admin: Admin,
  orgId: string,
  orgName?: string,
): Promise<boolean> {
  const owner = await lookupOwnerByOrgId(admin, orgId, { name: orgName });
  if (!owner) return false;
  return safeSend({
    to: owner.email,
    subject: TRIAL_DOWNGRADED_SUBJECT,
    html: buildTrialDowngradedEmailHtml({
      orgName: owner.orgName,
      upgradeUrl: upgradeUrl(),
    }),
    context: `trial-downgraded org=${orgId}`,
  });
}

/** invoice.payment_succeeded webhook fan-out. */
export async function sendPaymentSucceededEmail(
  admin: Admin,
  subscriptionId: string,
): Promise<boolean> {
  const owner = await lookupOwnerBySubscriptionId(admin, subscriptionId);
  if (!owner) return false;
  return safeSend({
    to: owner.email,
    subject: PAYMENT_SUCCEEDED_SUBJECT,
    html: buildPaymentSucceededEmailHtml({
      orgName: owner.orgName,
      manageBillingUrl: billingUrl(),
    }),
    context: `payment-succeeded sub=${subscriptionId}`,
  });
}

/** invoice.payment_failed webhook fan-out. */
export async function sendPaymentFailedEmail(
  admin: Admin,
  subscriptionId: string,
): Promise<boolean> {
  const owner = await lookupOwnerBySubscriptionId(admin, subscriptionId);
  if (!owner) return false;
  return safeSend({
    to: owner.email,
    subject: paymentFailedSubject(owner.orgName),
    html: buildPaymentFailedEmailHtml({
      orgName: owner.orgName,
      manageBillingUrl: billingUrl(),
    }),
    context: `payment-failed sub=${subscriptionId}`,
  });
}

/** customer.subscription.deleted webhook fan-out. */
export async function sendSubscriptionCancelledEmail(
  admin: Admin,
  subscriptionId: string,
): Promise<boolean> {
  const owner = await lookupOwnerBySubscriptionId(admin, subscriptionId);
  if (!owner) return false;
  return safeSend({
    to: owner.email,
    subject: SUBSCRIPTION_CANCELLED_SUBJECT,
    html: buildSubscriptionCancelledEmailHtml({
      orgName: owner.orgName,
      upgradeUrl: upgradeUrl(),
    }),
    context: `subscription-cancelled sub=${subscriptionId}`,
  });
}
