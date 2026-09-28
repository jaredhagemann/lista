import { getResend } from "@/lib/resend";

/**
 * Sending, and the billing subject lines. The emails themselves are React
 * Email templates in src/emails (spec: docs/specs/email-upgrade.md): each
 * renders to the `html` and `text` passed here.
 */

export type { FieldChange } from "@/emails/series-update-email";

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  /** The plain-text part, rendered from the same template. */
  text: string;
  /** The sender's display name for a club's email (EmailBrand.fromName); "lista" otherwise. */
  brandName?: string | null;
}

export async function sendEmail({ to, subject, html, text, brandName }: SendEmailParams) {
  const fromName = brandName ?? "lista";
  const { data, error } = await getResend().emails.send({
    from: `${fromName} <notifications@lista.team>`,
    to,
    subject,
    html,
    text,
  });

  if (error) {
    console.error("Failed to send email:", error);
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return data;
}

// ── Club billing email subjects (spec: "Email Notifications" table) ──────────

export const TRIAL_REMINDER_30D_SUBJECT =
  "30 days left in your Lista Club trial";
export const TRIAL_REMINDER_7D_SUBJECT =
  "7 days left — add a payment method to keep your club";
export const TRIAL_REMINDER_1D_SUBJECT = "Your trial ends tomorrow";
export const TRIAL_DOWNGRADED_SUBJECT =
  "Your trial has ended — your club has moved to Free";
export const PAYMENT_SUCCEEDED_SUBJECT =
  "Payment confirmed — thanks for subscribing";
export const SUBSCRIPTION_CANCELLED_SUBJECT =
  "Your Lista Club subscription has been cancelled";

export type ClubTier = "club_small" | "club_large";

export function trialConvertedSubject(tier: ClubTier): string {
  return tier === "club_small"
    ? "You're now on Lista Club Small"
    : "You're now on Lista Club Large";
}

export function paymentFailedSubject(orgName: string): string {
  return `Action required: payment failed for ${orgName}`;
}
