import type { ReactNode } from "react";
import { EmailButton, EmailHeading, EmailLayout, EmailText, renderEmail } from "@/emails/layout";
import { LISTA_BRAND } from "@/emails/brand";
import {
  PAYMENT_SUCCEEDED_SUBJECT,
  SUBSCRIPTION_CANCELLED_SUBJECT,
  TRIAL_DOWNGRADED_SUBJECT,
  paymentFailedSubject,
  trialConvertedSubject,
  type ClubTier,
} from "@/lib/notifications/email";

/**
 * The club billing emails (docs/specs/club-upgrade-monetization.md, "Email
 * Notifications"). They're lista's own mail to a club's owner, so they carry
 * lista's brand. Each is a pure function of its inputs.
 */

function BillingEmail({
  subject,
  orgName,
  body,
  cta,
}: {
  subject: string;
  orgName: string;
  body: ReactNode;
  cta: { label: string; url: string; danger?: boolean };
}) {
  return (
    <EmailLayout
      brand={LISTA_BRAND}
      preview={subject}
      footer={
        <>
          You received this email because you&apos;re an owner of a club on Lista.
          <br />
          Manage your subscription in your account settings.
        </>
      }
    >
      <EmailHeading>{subject}</EmailHeading>
      <EmailText>{`Hi ${orgName},`}</EmailText>
      <EmailText>{body}</EmailText>
      <EmailButton href={cta.url} brand={LISTA_BRAND} danger={cta.danger}>
        {cta.label}
      </EmailButton>
    </EmailLayout>
  );
}

export function renderTrialReminderEmail({
  orgName,
  subject,
  trialEndsAt,
  manageBillingUrl,
}: {
  orgName: string;
  subject: string;
  trialEndsAt: string | null;
  manageBillingUrl: string;
}) {
  const ends = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "soon";
  return renderEmail(
    <BillingEmail
      subject={subject}
      orgName={orgName}
      body={
        <>
          Your Lista Club trial ends on <strong>{ends}</strong>. Add a payment method now to keep your club&apos;s
          features running without interruption.
        </>
      }
      cta={{ label: "Add payment method", url: manageBillingUrl }}
    />
  );
}

export function renderTrialConvertedEmail({
  orgName,
  tier,
  manageBillingUrl,
}: {
  orgName: string;
  tier: ClubTier;
  manageBillingUrl: string;
}) {
  const tierLabel = tier === "club_small" ? "Club Small" : "Club Large";
  return renderEmail(
    <BillingEmail
      subject={trialConvertedSubject(tier)}
      orgName={orgName}
      body={
        <>
          Your trial has ended and your payment method was charged successfully — <strong>{orgName}</strong> is now
          on <strong>Lista {tierLabel}</strong>. Thanks for subscribing!
        </>
      }
      cta={{ label: "Manage billing", url: manageBillingUrl }}
    />
  );
}

export function renderTrialDowngradedEmail({ orgName, upgradeUrl }: { orgName: string; upgradeUrl: string }) {
  return renderEmail(
    <BillingEmail
      subject={TRIAL_DOWNGRADED_SUBJECT}
      orgName={orgName}
      body={
        <>
          Your Lista Club trial has ended. Because no payment method was on file, <strong>{orgName}</strong> has
          moved to the Free plan. Your data is preserved — you can upgrade any time to restore Club features.
        </>
      }
      cta={{ label: "Upgrade again", url: upgradeUrl }}
    />
  );
}

export function renderPaymentSucceededEmail({ orgName, manageBillingUrl }: { orgName: string; manageBillingUrl: string }) {
  return renderEmail(
    <BillingEmail
      subject={PAYMENT_SUCCEEDED_SUBJECT}
      orgName={orgName}
      body={
        <>
          We&apos;ve received your payment. Your Lista Club subscription is active and ready to use. You can review
          invoices and update your payment method any time.
        </>
      }
      cta={{ label: "Billing history", url: manageBillingUrl }}
    />
  );
}

export function renderPaymentFailedEmail({ orgName, manageBillingUrl }: { orgName: string; manageBillingUrl: string }) {
  return renderEmail(
    <BillingEmail
      subject={paymentFailedSubject(orgName)}
      orgName={orgName}
      body={
        <>
          Your most recent invoice for <strong>{orgName}</strong> couldn&apos;t be charged. Please update your
          payment method to keep your Lista Club subscription active — Stripe will automatically retry over the next
          few days.
        </>
      }
      cta={{ label: "Update payment method", url: manageBillingUrl, danger: true }}
    />
  );
}

export function renderSubscriptionCancelledEmail({ orgName, upgradeUrl }: { orgName: string; upgradeUrl: string }) {
  return renderEmail(
    <BillingEmail
      subject={SUBSCRIPTION_CANCELLED_SUBJECT}
      orgName={orgName}
      body={
        <>
          Your Lista Club subscription has been cancelled and <strong>{orgName}</strong> has moved to the Free plan.
          Your team data is preserved — you can re-subscribe any time to restore Club features.
        </>
      }
      cta={{ label: "Re-subscribe", url: upgradeUrl }}
    />
  );
}
