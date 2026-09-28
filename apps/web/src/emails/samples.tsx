import { LISTA_BRAND, clubEmailBrand, type EmailBrand } from "@/emails/brand";
import type { RenderedEmail } from "@/emails/layout";
import { renderInviteEmail } from "@/emails/invite-email";
import { renderEventEmail } from "@/emails/event-email";
import { renderSeriesUpdateEmail } from "@/emails/series-update-email";
import { renderConfirmationEmail } from "@/emails/confirmation-email";
import { renderClubNoticeEmail } from "@/emails/club-notice-email";
import { renderTeamDeletionEmail } from "@/emails/team-deletion-email";
import {
  renderPaymentFailedEmail,
  renderPaymentSucceededEmail,
  renderSubscriptionCancelledEmail,
  renderTrialConvertedEmail,
  renderTrialDowngradedEmail,
  renderTrialReminderEmail,
} from "@/emails/billing-emails";
import { TRIAL_REMINDER_7D_SUBJECT } from "@/lib/notifications/email";

/**
 * Every email with sample data, for previewing and for test sends to real
 * inboxes (scripts/email-previews.ts; spec: docs/specs/email-upgrade.md §5).
 * Emails that can carry a club's brand appear twice: as a club's and as lista's.
 */

/** `brand` is who it's from, for a test send. */
export type EmailSample = { name: string; subject: string; brand: EmailBrand; render: () => Promise<RenderedEmail> };

const APP = "https://lista.team";

/** A sample club. The logo is a stand-in image; pass a real one with --logo. */
export function sampleClub(logoUrl = "https://placehold.co/240x72/C8102E/ffffff/png?text=SLOFC"): EmailBrand {
  return clubEmailBrand({
    name: "San Luis Obispo FC",
    org_name_public: "SLOFC",
    logo_url: logoUrl,
    plan: "club_small",
    brand_color_secondary: "#C8102E",
  });
}

export function emailSamples(club: EmailBrand = sampleClub()): EmailSample[] {
  const brands: Array<[string, EmailBrand]> = [
    ["club", club],
    ["lista", LISTA_BRAND],
  ];
  const game = {
    eventTitle: "12U Girls vs Rivals FC",
    eventType: "game",
    startTime: "2026-10-03T17:00:00Z",
    endTime: "2026-10-03T18:30:00Z",
    location: "Damon-Garcia Sports Fields",
    teamName: "12U Girls",
    arrivalTime: 45,
    eventUrl: `${APP}/dashboard/schedule/sample`,
    timeZone: "America/Los_Angeles",
  };

  return [
    ...brands.flatMap(([label, brand]): EmailSample[] => [
      {
        name: `invite-${label}`,
        brand,
        subject: `You've been invited to join 12U Girls on ${brand.name}`,
        render: () =>
          renderInviteEmail({ teamName: "12U Girls", inviterName: "Sam Okafor", role: "player", inviteUrl: `${APP}/invite/sample`, brand }),
      },
      {
        name: `event-reminder-${label}`,
        brand,
        subject: "Reminder: 12U Girls vs Rivals FC tomorrow",
        render: () => renderEventEmail({ ...game, action: "reminder", brand }),
      },
      {
        name: `event-created-${label}`,
        brand,
        subject: "New event: 12U Girls vs Rivals FC",
        render: () => renderEventEmail({ ...game, action: "created", brand }),
      },
      {
        name: `event-updated-${label}`,
        brand,
        subject: "Updated: 12U Girls vs Rivals FC",
        render: () => renderEventEmail({ ...game, action: "updated", brand }),
      },
      {
        name: `event-cancelled-${label}`,
        brand,
        subject: "Cancelled: 12U Girls vs Rivals FC",
        render: () => renderEventEmail({ ...game, action: "cancelled", brand }),
      },
      {
        name: `series-update-${label}`,
        brand,
        subject: "Schedule updated: Tuesday practice",
        render: () =>
          renderSeriesUpdateEmail({
            eventTitle: "Tuesday practice",
            teamName: "12U Girls",
            changes: [
              { field: "Time", before: "4:00 PM – 5:30 PM PDT", after: "5:00 PM – 6:30 PM PDT" },
              { field: "Location", before: "Islay Park", after: "Sinsheimer Park" },
            ],
            brand,
          }),
      },
      {
        name: `confirmation-${label}`,
        brand,
        subject: `Confirm your ${brand.name} account`,
        render: () => renderConfirmationEmail({ confirmUrl: `${APP}/auth/confirm?sample`, firstName: "Ava", brand }),
      },
    ]),
    {
      name: "director-invite-club",
      brand: club,
      subject: "You've been invited to help run SLOFC on SLOFC",
      render: () =>
        renderInviteEmail({
          teamName: "SLOFC",
          inviterName: "Olive Owner",
          role: "director",
          inviteUrl: `${APP}/invite/sample`,
          brand: club,
          kind: "club",
        }),
    },
    {
      name: "club-ownership-offer",
      brand: club,
      subject: "Olive Owner wants to hand SLOFC over to you",
      render: () =>
        renderClubNoticeEmail({
          heading: "You've been offered ownership of SLOFC",
          paragraphs: [
            [{ strong: "Olive Owner" }, " would like you to become the owner of ", { strong: "SLOFC" }, " on Lista."],
            "As owner you'll be responsible for the club's billing and settings. Olive Owner will stay on as a director.",
            "The offer expires in 14 days. You can accept or decline it from the club portal.",
          ],
          cta: { label: "Review the offer", url: `${APP}/dashboard/club` },
          footer: "You received this email because you're an owner or director of a club on Lista.",
          brand: club,
        }),
    },
    {
      name: "team-deleted",
      brand: LISTA_BRAND,
      subject: "12U Girls has been deleted",
      render: () => renderTeamDeletionEmail({ teamName: "12U Girls" }),
    },
    {
      name: "billing-trial-reminder",
      brand: LISTA_BRAND,
      subject: TRIAL_REMINDER_7D_SUBJECT,
      render: () =>
        renderTrialReminderEmail({
          orgName: "SLOFC",
          subject: TRIAL_REMINDER_7D_SUBJECT,
          trialEndsAt: "2026-10-10T00:00:00Z",
          manageBillingUrl: `${APP}/dashboard/club/billing`,
        }),
    },
    {
      name: "billing-trial-converted",
      brand: LISTA_BRAND,
      subject: "You're now on Lista Club Small",
      render: () => renderTrialConvertedEmail({ orgName: "SLOFC", tier: "club_small", manageBillingUrl: `${APP}/dashboard/club/billing` }),
    },
    {
      name: "billing-trial-downgraded",
      brand: LISTA_BRAND,
      subject: "Your trial has ended",
      render: () => renderTrialDowngradedEmail({ orgName: "SLOFC", upgradeUrl: `${APP}/dashboard/club/upgrade` }),
    },
    {
      name: "billing-payment-succeeded",
      brand: LISTA_BRAND,
      subject: "Payment confirmed",
      render: () => renderPaymentSucceededEmail({ orgName: "SLOFC", manageBillingUrl: `${APP}/dashboard/club/billing` }),
    },
    {
      name: "billing-payment-failed",
      brand: LISTA_BRAND,
      subject: "Action required: payment failed for SLOFC",
      render: () => renderPaymentFailedEmail({ orgName: "SLOFC", manageBillingUrl: `${APP}/dashboard/club/billing` }),
    },
    {
      name: "billing-subscription-cancelled",
      brand: LISTA_BRAND,
      subject: "Your Lista Club subscription has been cancelled",
      render: () => renderSubscriptionCancelledEmail({ orgName: "SLOFC", upgradeUrl: `${APP}/dashboard/club/upgrade` }),
    },
  ];
}
