import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { adminClient } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe";
import {
  sendTrialReminderEmail,
  sendTrialConvertedEmail,
  sendTrialDowngradedEmail,
} from "@/lib/notifications/billing-emails";
import {
  TRIAL_REMINDER_30D_SUBJECT,
  TRIAL_REMINDER_7D_SUBJECT,
  TRIAL_REMINDER_1D_SUBJECT,
} from "@/lib/notifications/email";
import { priceIdForPlan, teamLimitForPlan } from "@/lib/billing";
import { isClubPlan, type ClubPlan } from "@/lib/plan";

/**
 * POST /api/cron/trial-expiration  (also reachable via GET — Vercel cron uses GET by default)
 *
 * Daily cron: send 30/7/1-day trial reminders, then expire trials by either
 * converting them to a paid Stripe subscription or downgrading to Free.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "During Trial" (reminders)
 * and "Trial Expiration (Day 91 Cron)".
 *
 * Auth: Bearer `CRON_SECRET` (matches the existing reminders cron). Without a
 * valid secret the route returns 401 — Stripe and the email sender are never
 * touched.
 *
 * Idempotency:
 *   - Reminders: each tier has a sent-at column. The query filters rows where
 *     the column is NULL; the column is written immediately after a successful
 *     Resend response, so reruns within the same window skip already-sent orgs.
 *     A Resend failure before the write leaves the column NULL so the next run
 *     retries — acceptable since at-most-once delivery is not guaranteed anyway.
 *   - Expiration: the query filters on `stripe_subscription_id IS NULL` AND
 *     `subscription_status = 'trialing'`. After `subscriptions.create` we write
 *     `stripe_subscription_id` immediately, so the same org won't be retried.
 *     The Stripe call itself uses `idempotencyKey: trial-convert-{orgId}` so
 *     duplicate calls within Stripe's 24h window return the existing object.
 */

const REMINDERS = [
  {
    daysLower: 29,
    daysUpper: 31,
    sentAtColumn: "trial_reminder_30d_sent_at",
    subject: TRIAL_REMINDER_30D_SUBJECT,
  },
  {
    daysLower: 6,
    daysUpper: 8,
    sentAtColumn: "trial_reminder_7d_sent_at",
    subject: TRIAL_REMINDER_7D_SUBJECT,
  },
  {
    daysLower: 0,
    daysUpper: 2,
    sentAtColumn: "trial_reminder_1d_sent_at",
    subject: TRIAL_REMINDER_1D_SUBJECT,
  },
] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type ReminderStats = { d30: number; d7: number; d1: number };
type ExpirationStats = {
  converted: number;
  downgraded: number;
  adopted: number;
  skipped: number;
  failed: number;
};

type AdminClient = ReturnType<typeof adminClient>;

async function handler(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = adminClient();
  const stripe = getStripe();
  const now = new Date();

  const reminders = await runReminders(admin, now);
  const expirations = await runExpirations(admin, stripe, now);

  return NextResponse.json({ ok: true, reminders, expirations });
}

export const GET = handler;
export const POST = handler;

// ── Reminders ────────────────────────────────────────────────────────────────

async function runReminders(
  admin: AdminClient,
  now: Date,
): Promise<ReminderStats> {
  const stats: ReminderStats = { d30: 0, d7: 0, d1: 0 };

  for (const reminder of REMINDERS) {
    const lower = new Date(now.getTime() + reminder.daysLower * MS_PER_DAY);
    const upper = new Date(now.getTime() + reminder.daysUpper * MS_PER_DAY);

    // Query: trialing orgs whose trial_ends_at falls in the ±1-day window AND
    // whose sent-at column for this tier is still NULL. The ±1-day band keeps
    // the reminder reachable even if the cron missed a run.
    const { data: orgs, error } = await admin
      .from("organizations")
      .select("id, name, trial_ends_at")
      .eq("subscription_status", "trialing")
      .gte("trial_ends_at", lower.toISOString())
      .lte("trial_ends_at", upper.toISOString())
      .is(reminder.sentAtColumn, null);

    if (error || !orgs) continue;

    for (const org of orgs) {
      const ownerEmail = await fetchOwnerEmail(admin, org.id);
      if (!ownerEmail) continue;

      try {
        await sendTrialReminderEmail({
          to: ownerEmail,
          orgName: org.name,
          subject: reminder.subject,
          trialEndsAt: org.trial_ends_at,
        });

        // Write the sent-at column ONLY after a successful send so a failed
        // delivery leaves the row eligible for retry next run.
        await admin
          .from("organizations")
          .update({ [reminder.sentAtColumn]: new Date().toISOString() })
          .eq("id", org.id);

        if (reminder.daysLower === 29) stats.d30++;
        else if (reminder.daysLower === 6) stats.d7++;
        else stats.d1++;
      } catch (err) {
        console.error(
          `Trial reminder ${reminder.sentAtColumn} send failed for org ${org.id}:`,
          err,
        );
      }
    }
  }

  return stats;
}

// ── Expirations ──────────────────────────────────────────────────────────────

async function runExpirations(
  admin: AdminClient,
  stripe: Stripe,
  now: Date,
): Promise<ExpirationStats> {
  const stats: ExpirationStats = {
    converted: 0,
    downgraded: 0,
    adopted: 0,
    skipped: 0,
    failed: 0,
  };

  // Idempotency guard at the query level: skip orgs whose subscription was
  // already created (via webhook or a prior run). Combined with the per-org
  // write-back of stripe_subscription_id below, this prevents the cron from
  // converting the same trial twice even across long webhook delays.
  const { data: expiringOrgs, error } = await admin
    .from("organizations")
    .select(
      "id, name, plan, stripe_customer_id, stripe_subscription_id, trial_ends_at",
    )
    .eq("subscription_status", "trialing")
    .lt("trial_ends_at", now.toISOString())
    .is("stripe_subscription_id", null);

  if (error || !expiringOrgs) return stats;

  for (const org of expiringOrgs) {
    // Defensive re-check (the query already filters but a concurrent webhook
    // could have written between the query and this loop iteration).
    if (org.stripe_subscription_id) {
      stats.skipped++;
      continue;
    }

    if (!isClubPlan(org.plan)) {
      // Trialing but not on a club tier is malformed state — skip rather than
      // attempting a conversion against an unknown price.
      stats.skipped++;
      continue;
    }

    const tierPlan: ClubPlan = org.plan;

    // No customer means no payment method possible — downgrade.
    if (!org.stripe_customer_id) {
      const downErr = await downgrade(admin, org.id);
      if (downErr) {
        stats.failed++;
      } else {
        stats.downgraded++;
        await sendTrialDowngradedEmail(admin, org.id, org.name);
      }
      continue;
    }

    let defaultPm: string | null;
    try {
      const customer = await stripe.customers.retrieve(org.stripe_customer_id);
      defaultPm = readDefaultPaymentMethod(customer);
    } catch (err) {
      console.error(
        `Stripe customer.retrieve failed for org ${org.id}:`,
        err,
      );
      stats.failed++;
      continue;
    }

    // Spec "Downgrade path (no payment method)": null default_pm → downgrade.
    // An attached card that is NOT the invoice default would not be charged by
    // a fresh subscription (no subscription default_pm and no
    // customer.default_source either), so null here truly means "we can't bill".
    if (!defaultPm) {
      const downErr = await downgrade(admin, org.id);
      if (downErr) {
        stats.failed++;
      } else {
        stats.downgraded++;
        await sendTrialDowngradedEmail(admin, org.id, org.name);
      }
      continue;
    }

    // Spec "Conversion path" step 2: adopt a pre-existing active subscription
    // if one was created out-of-band (e.g. a previous cron run whose
    // subscriptions.create succeeded but whose DB write failed). Without this
    // branch the org would stay stuck in `trialing` and the cron would retry
    // forever even though Stripe's idempotency key has expired (24h).
    let existingActive: Stripe.Subscription | null;
    try {
      const list = await stripe.subscriptions.list({
        customer: org.stripe_customer_id,
        status: "active",
        limit: 1,
      });
      existingActive = list.data[0] ?? null;
    } catch (err) {
      console.error(
        `Stripe subscriptions.list failed for org ${org.id}:`,
        err,
      );
      stats.failed++;
      continue;
    }

    if (existingActive) {
      const { error: updateErr } = await admin
        .from("organizations")
        .update({
          stripe_subscription_id: existingActive.id,
          subscription_status: "active",
        })
        .eq("id", org.id);
      if (updateErr) {
        console.error(
          `DB write failed adopting existing sub for org ${org.id}:`,
          updateErr,
        );
        stats.failed++;
      } else {
        stats.adopted++;
        // Same tier as the existing sub — we don't re-read the price ID here
        // because the org's `plan` column is the source of truth for the tier
        // label (set when the trial was started by start-trial).
        await sendTrialConvertedEmail(admin, org.id, tierPlan, org.name);
      }
      continue;
    }

    // Conversion: create the subscription with an explicit
    // `default_payment_method` so the charge does NOT depend on the customer
    // default being preserved, and a deterministic idempotency key so a
    // duplicate run within 24h returns the same subscription rather than
    // double-billing.
    let priceId: string;
    try {
      priceId = priceIdForPlan(tierPlan);
    } catch (err) {
      console.error(`priceIdForPlan failed for org ${org.id}:`, err);
      stats.failed++;
      continue;
    }

    let subscription: Stripe.Subscription;
    try {
      subscription = await stripe.subscriptions.create(
        {
          customer: org.stripe_customer_id,
          items: [{ price: priceId }],
          default_payment_method: defaultPm,
          metadata: { org_id: org.id },
        },
        { idempotencyKey: `trial-convert-${org.id}` },
      );
    } catch (err) {
      console.error(
        `Stripe subscriptions.create failed for org ${org.id}:`,
        err,
      );
      stats.failed++;
      continue;
    }

    // Immediately write the subscription id so subsequent cron runs skip this
    // org via the IS NULL filter, regardless of webhook arrival timing.
    const { error: updateErr } = await admin
      .from("organizations")
      .update({
        stripe_subscription_id: subscription.id,
        subscription_status: "active",
      })
      .eq("id", org.id);

    if (updateErr) {
      console.error(
        `DB write failed after subscriptions.create for org ${org.id}:`,
        updateErr,
      );
      stats.failed++;
    } else {
      stats.converted++;
      await sendTrialConvertedEmail(admin, org.id, tierPlan, org.name);
    }
  }

  return stats;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchOwnerEmail(
  admin: AdminClient,
  orgId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("organization_members")
    .select("profiles(email)")
    .eq("organization_id", orgId)
    .eq("role", "owner")
    .maybeSingle();
  const profile = (data as { profiles?: { email?: string | null } | null } | null)
    ?.profiles;
  return profile?.email ?? null;
}

async function downgrade(
  admin: AdminClient,
  orgId: string,
): Promise<unknown | null> {
  // Spec "Downgrade path": plan → 'free', subscription_status → NULL,
  // team_limit → 1. trial_ends_at is intentionally NOT touched — it remains
  // the permanent "trial consumed" gate. Existing teams are preserved.
  const { error } = await admin
    .from("organizations")
    .update({
      plan: "free",
      team_limit: teamLimitForPlan("free"),
      subscription_status: null,
    })
    .eq("id", orgId);
  return error ?? null;
}

function readDefaultPaymentMethod(
  customer: Stripe.Customer | Stripe.DeletedCustomer,
): string | null {
  if (customer.deleted) return null;
  const pm = customer.invoice_settings?.default_payment_method;
  if (!pm) return null;
  return typeof pm === "string" ? pm : pm.id ?? null;
}
