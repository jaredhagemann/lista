/**
 * Unit tests for the club-billing email layer.
 *
 * Spec: docs/specs/club-upgrade-monetization.md → "Email Notifications" table.
 * Each spec row maps to:
 *   1. A subject constant (or builder) exported from @/lib/notifications/email
 *   2. A pure HTML builder also exported from @/lib/notifications/email
 *   3. A "resolve owner + send" orchestration helper in
 *      @/lib/notifications/billing-emails
 *
 * Tests cover all three layers so a future regression on any of:
 *   - subject string drift (e.g. someone renames "Lista Club" → "Lista")
 *   - template missing the org name or CTA link
 *   - orchestration helper failing to look up the owner email
 * is caught here rather than silently producing wrong customer mail.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── 1. Subject constants / builders ──────────────────────────────────────────

import {
  TRIAL_REMINDER_30D_SUBJECT,
  TRIAL_REMINDER_7D_SUBJECT,
  TRIAL_REMINDER_1D_SUBJECT,
  TRIAL_DOWNGRADED_SUBJECT,
  PAYMENT_SUCCEEDED_SUBJECT,
  SUBSCRIPTION_CANCELLED_SUBJECT,
  trialConvertedSubject,
  paymentFailedSubject,
  buildTrialReminderEmailHtml,
  buildTrialConvertedEmailHtml,
  buildTrialDowngradedEmailHtml,
  buildPaymentSucceededEmailHtml,
  buildPaymentFailedEmailHtml,
  buildSubscriptionCancelledEmailHtml,
} from "@/lib/notifications/email";

describe("billing email — subjects", () => {
  it("matches the spec's exact subject strings (regression guard)", () => {
    expect(TRIAL_REMINDER_30D_SUBJECT).toBe(
      "30 days left in your Lista Club trial",
    );
    expect(TRIAL_REMINDER_7D_SUBJECT).toBe(
      "7 days left — add a payment method to keep your club",
    );
    expect(TRIAL_REMINDER_1D_SUBJECT).toBe("Your trial ends tomorrow");
    expect(TRIAL_DOWNGRADED_SUBJECT).toBe(
      "Your trial has ended — your club has moved to Free",
    );
    expect(PAYMENT_SUCCEEDED_SUBJECT).toBe(
      "Payment confirmed — thanks for subscribing",
    );
    expect(SUBSCRIPTION_CANCELLED_SUBJECT).toBe(
      "Your Lista Club subscription has been cancelled",
    );
  });

  it("trialConvertedSubject swaps tier label per spec", () => {
    expect(trialConvertedSubject("club_small")).toBe(
      "You're now on Lista Club Small",
    );
    expect(trialConvertedSubject("club_large")).toBe(
      "You're now on Lista Club Large",
    );
  });

  it("paymentFailedSubject interpolates the org name (spec uses [org name] placeholder)", () => {
    expect(paymentFailedSubject("Acme FC")).toBe(
      "Action required: payment failed for Acme FC",
    );
  });
});

// ── 2. Pure HTML builders ────────────────────────────────────────────────────

describe("billing email — buildTrialReminderEmailHtml", () => {
  it("includes the subject, org name, formatted trial-end date, and CTA URL", () => {
    const html = buildTrialReminderEmailHtml({
      orgName: "Acme FC",
      subject: TRIAL_REMINDER_30D_SUBJECT,
      trialEndsAt: "2026-08-19T12:00:00Z",
      manageBillingUrl: "https://app.example.com/dashboard/club/billing",
    });
    expect(html).toContain("30 days left in your Lista Club trial");
    expect(html).toContain("Acme FC");
    expect(html).toContain("August 19, 2026");
    expect(html).toContain("https://app.example.com/dashboard/club/billing");
    expect(html).toContain("Add payment method");
  });

  it("falls back to 'soon' when trialEndsAt is null (defensive — query already filters NOT NULL)", () => {
    const html = buildTrialReminderEmailHtml({
      orgName: "Beta FC",
      subject: TRIAL_REMINDER_7D_SUBJECT,
      trialEndsAt: null,
      manageBillingUrl: "https://x/y",
    });
    expect(html).toContain("ends on <strong>soon</strong>");
  });
});

describe("billing email — buildTrialConvertedEmailHtml", () => {
  it("renders the Club Small subject + label when tier='club_small'", () => {
    const html = buildTrialConvertedEmailHtml({
      orgName: "Acme FC",
      tier: "club_small",
      manageBillingUrl: "https://x/y",
    });
    expect(html).toContain("You're now on Lista Club Small");
    expect(html).toContain("Lista Club Small");
  });

  it("renders the Club Large subject + label when tier='club_large'", () => {
    const html = buildTrialConvertedEmailHtml({
      orgName: "Big FC",
      tier: "club_large",
      manageBillingUrl: "https://x/y",
    });
    expect(html).toContain("You're now on Lista Club Large");
    expect(html).toContain("Lista Club Large");
  });

  it("includes the org name and Manage-billing CTA href", () => {
    const html = buildTrialConvertedEmailHtml({
      orgName: "Acme FC",
      tier: "club_small",
      manageBillingUrl: "https://app.example/billing",
    });
    expect(html).toContain("Acme FC");
    expect(html).toContain('href="https://app.example/billing"');
    expect(html).toContain("Manage billing");
  });
});

describe("billing email — buildTrialDowngradedEmailHtml", () => {
  it("uses the spec subject and links to the upgrade page", () => {
    const html = buildTrialDowngradedEmailHtml({
      orgName: "Acme FC",
      upgradeUrl: "https://app.example/upgrade",
    });
    expect(html).toContain(TRIAL_DOWNGRADED_SUBJECT);
    expect(html).toContain("Acme FC");
    expect(html).toContain('href="https://app.example/upgrade"');
    expect(html).toContain("Upgrade again");
  });
});

describe("billing email — buildPaymentSucceededEmailHtml", () => {
  it("uses the spec subject and includes a Billing-history CTA", () => {
    const html = buildPaymentSucceededEmailHtml({
      orgName: "Acme FC",
      manageBillingUrl: "https://app.example/billing",
    });
    expect(html).toContain(PAYMENT_SUCCEEDED_SUBJECT);
    expect(html).toContain("Acme FC");
    expect(html).toContain('href="https://app.example/billing"');
    expect(html).toContain("Billing history");
  });
});

describe("billing email — buildPaymentFailedEmailHtml", () => {
  it("interpolates org name into both the subject and body, and uses a red CTA", () => {
    const html = buildPaymentFailedEmailHtml({
      orgName: "Acme FC",
      manageBillingUrl: "https://app.example/billing",
    });
    expect(html).toContain("Action required: payment failed for Acme FC");
    // Red CTA visually signals urgency vs the default blue.
    expect(html).toContain("#dc2626");
    expect(html).toContain("Update payment method");
  });
});

describe("billing email — buildSubscriptionCancelledEmailHtml", () => {
  it("uses the spec subject and offers a Re-subscribe CTA", () => {
    const html = buildSubscriptionCancelledEmailHtml({
      orgName: "Acme FC",
      upgradeUrl: "https://app.example/upgrade",
    });
    expect(html).toContain(SUBSCRIPTION_CANCELLED_SUBJECT);
    expect(html).toContain("Acme FC");
    expect(html).toContain('href="https://app.example/upgrade"');
    expect(html).toContain("Re-subscribe");
  });
});

// ── 3. Orchestration helpers (billing-emails.ts) ─────────────────────────────
//
// The orchestration layer looks up `organization_members.role = 'owner'` →
// profiles(email), looks up the org name (when not provided), and dispatches
// the right template via @/lib/notifications/email.sendEmail. Tests below mock
// sendEmail and assert: (a) the lookup happens with the right WHERE clause,
// (b) the resolved owner email + org name end up in the send args, (c) a
// missing owner email short-circuits without throwing.

const sendMocks = vi.hoisted(() => {
  const sendEmail = vi.fn();

  type SelectCall = {
    table: string;
    columns: string;
    filters: Array<{ op: string; column: string; value?: unknown }>;
  };
  const selectCalls: SelectCall[] = [];
  const selectQueues: Record<string, unknown[]> = {};

  const makeSelectChain = (val: unknown, call: SelectCall) => {
    const promise = Promise.resolve({ data: val, error: null });
    const record =
      (op: string) =>
      (column: string, value?: unknown) => {
        call.filters.push({ op, column, value });
        return chain;
      };
    const chain: Record<string, unknown> = {
      eq: record("eq"),
      maybeSingle: () => promise,
      single: () => promise,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        promise.then(res, rej),
    };
    return chain;
  };

  const mockFrom = vi.fn().mockImplementation((table: string) => ({
    select: (columns: string) => {
      const call: SelectCall = { table, columns, filters: [] };
      selectCalls.push(call);
      const queue = selectQueues[table];
      const val = queue && queue.length > 0 ? queue.shift() : null;
      return makeSelectChain(val ?? null, call);
    },
  }));

  return { sendEmail, mockFrom, selectCalls, selectQueues };
});

vi.mock("@/lib/notifications/email", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("@/lib/notifications/email");
  return {
    ...actual,
    sendEmail: sendMocks.sendEmail,
  };
});

import {
  sendTrialConvertedEmail,
  sendTrialDowngradedEmail,
  sendPaymentSucceededEmail,
  sendPaymentFailedEmail,
  sendSubscriptionCancelledEmail,
} from "@/lib/notifications/billing-emails";

const fakeAdmin = () =>
  ({ from: sendMocks.mockFrom }) as unknown as Parameters<
    typeof sendTrialConvertedEmail
  >[0];

beforeEach(() => {
  vi.clearAllMocks();
  sendMocks.selectCalls.length = 0;
  Object.keys(sendMocks.selectQueues).forEach(
    (k) => delete sendMocks.selectQueues[k],
  );
  sendMocks.sendEmail.mockResolvedValue({ id: "msg_ok" });
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("billing-emails — sendTrialConvertedEmail", () => {
  it("looks up the owner via organization_members + profiles and sends with the right tier subject", async () => {
    sendMocks.selectQueues.organization_members = [
      { profiles: { email: "owner@acme.test" } },
    ];

    const sent = await sendTrialConvertedEmail(
      fakeAdmin(),
      "org-1",
      "club_small",
      "Acme FC",
    );

    expect(sent).toBe(true);
    expect(sendMocks.sendEmail).toHaveBeenCalledTimes(1);
    const args = sendMocks.sendEmail.mock.calls[0][0];
    expect(args.to).toBe("owner@acme.test");
    expect(args.subject).toBe("You're now on Lista Club Small");
    expect(args.html).toContain("Acme FC");
    expect(args.html).toContain(
      "https://app.example/dashboard/club/billing",
    );

    // The lookup filtered on organization_id + role='owner' — the lookup must
    // not return a coach or manager email.
    const memberSelect = sendMocks.selectCalls.find(
      (c) => c.table === "organization_members",
    );
    expect(memberSelect?.filters).toContainEqual({
      op: "eq",
      column: "organization_id",
      value: "org-1",
    });
    expect(memberSelect?.filters).toContainEqual({
      op: "eq",
      column: "role",
      value: "owner",
    });
  });

  it("falls back to looking up the org name when not provided by the caller", async () => {
    sendMocks.selectQueues.organization_members = [
      { profiles: { email: "owner@acme.test" } },
    ];
    sendMocks.selectQueues.organizations = [{ name: "Lookup Co" }];

    await sendTrialConvertedEmail(fakeAdmin(), "org-2", "club_large");

    const args = sendMocks.sendEmail.mock.calls[0][0];
    expect(args.html).toContain("Lookup Co");
  });

  it("returns false without sending when no owner email can be resolved", async () => {
    sendMocks.selectQueues.organization_members = [null];

    const sent = await sendTrialConvertedEmail(
      fakeAdmin(),
      "org-no-owner",
      "club_small",
      "Acme FC",
    );

    expect(sent).toBe(false);
    expect(sendMocks.sendEmail).not.toHaveBeenCalled();
  });

  it("swallows a Resend failure (returns false) so callers don't have to wrap try/catch", async () => {
    sendMocks.selectQueues.organization_members = [
      { profiles: { email: "owner@acme.test" } },
    ];
    sendMocks.sendEmail.mockRejectedValueOnce(new Error("Resend down"));

    const sent = await sendTrialConvertedEmail(
      fakeAdmin(),
      "org-1",
      "club_small",
      "Acme FC",
    );

    expect(sent).toBe(false);
  });
});

describe("billing-emails — sendTrialDowngradedEmail", () => {
  it("sends the spec subject + body when the owner is resolved", async () => {
    sendMocks.selectQueues.organization_members = [
      { profiles: { email: "owner@acme.test" } },
    ];

    const sent = await sendTrialDowngradedEmail(
      fakeAdmin(),
      "org-1",
      "Acme FC",
    );

    expect(sent).toBe(true);
    const args = sendMocks.sendEmail.mock.calls[0][0];
    expect(args.to).toBe("owner@acme.test");
    expect(args.subject).toBe(TRIAL_DOWNGRADED_SUBJECT);
    expect(args.html).toContain("Acme FC");
    expect(args.html).toContain(
      "https://app.example/dashboard/settings?tab=plan",
    );
  });
});

describe("billing-emails — sendPaymentSucceededEmail", () => {
  it("resolves org + owner via stripe_subscription_id and sends the spec subject", async () => {
    sendMocks.selectQueues.organizations = [{ id: "org-1", name: "Acme FC" }];
    sendMocks.selectQueues.organization_members = [
      { profiles: { email: "owner@acme.test" } },
    ];

    const sent = await sendPaymentSucceededEmail(fakeAdmin(), "sub_paid");

    expect(sent).toBe(true);
    const args = sendMocks.sendEmail.mock.calls[0][0];
    expect(args.to).toBe("owner@acme.test");
    expect(args.subject).toBe(PAYMENT_SUCCEEDED_SUBJECT);
    expect(args.html).toContain("Acme FC");

    // The subscription-id lookup must filter the org table by
    // stripe_subscription_id (not by id) — invoice events don't carry an org id.
    const orgSelect = sendMocks.selectCalls.find(
      (c) => c.table === "organizations",
    );
    expect(orgSelect?.filters).toContainEqual({
      op: "eq",
      column: "stripe_subscription_id",
      value: "sub_paid",
    });
  });

  it("returns false silently when no org matches the subscription id", async () => {
    sendMocks.selectQueues.organizations = [null];

    const sent = await sendPaymentSucceededEmail(fakeAdmin(), "sub_unknown");

    expect(sent).toBe(false);
    expect(sendMocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe("billing-emails — sendPaymentFailedEmail", () => {
  it("interpolates the org name into both the subject and the body", async () => {
    sendMocks.selectQueues.organizations = [
      { id: "org-1", name: "Acme FC" },
    ];
    sendMocks.selectQueues.organization_members = [
      { profiles: { email: "owner@acme.test" } },
    ];

    const sent = await sendPaymentFailedEmail(fakeAdmin(), "sub_failed");

    expect(sent).toBe(true);
    const args = sendMocks.sendEmail.mock.calls[0][0];
    expect(args.subject).toBe("Action required: payment failed for Acme FC");
    expect(args.html).toContain("Acme FC");
  });
});

describe("billing-emails — sendSubscriptionCancelledEmail", () => {
  it("uses the spec subject and links to the upgrade page (re-subscribe path)", async () => {
    sendMocks.selectQueues.organizations = [
      { id: "org-1", name: "Acme FC" },
    ];
    sendMocks.selectQueues.organization_members = [
      { profiles: { email: "owner@acme.test" } },
    ];

    const sent = await sendSubscriptionCancelledEmail(fakeAdmin(), "sub_dead");

    expect(sent).toBe(true);
    const args = sendMocks.sendEmail.mock.calls[0][0];
    expect(args.subject).toBe(SUBSCRIPTION_CANCELLED_SUBJECT);
    expect(args.html).toContain("Acme FC");
    expect(args.html).toContain(
      "https://app.example/dashboard/settings?tab=plan",
    );
  });
});
