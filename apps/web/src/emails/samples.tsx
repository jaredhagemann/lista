import { LISTA_BRAND, clubEmailBrand, type EmailBrand } from "@/emails/brand";
import type { RenderedEmail } from "@/emails/layout";
import { renderInviteEmail } from "@/emails/invite-email";
import { renderEventEmail, type AnswerRow } from "@/emails/event-email";
import { gameTitle } from "@/lib/events/game-display";
import { renderSeriesUpdateEmail } from "@/emails/series-update-email";
import { renderConfirmationEmail } from "@/emails/confirmation-email";
import { renderClubNoticeEmail } from "@/emails/club-notice-email";
import { renderTeamDeletionEmail } from "@/emails/team-deletion-email";
import {
  OWNERSHIP_NOTICE_FOOTER,
  clubClosedNotice,
  ownershipChangedNotice,
  transferDeclinedNotice,
  transferOfferNotice,
  type ClubNotice,
} from "@/emails/club-notices";
import {
  renderPaymentFailedEmail,
  renderPaymentSucceededEmail,
  renderSubscriptionCancelledEmail,
  renderTrialConvertedEmail,
  renderTrialDowngradedEmail,
  renderTrialReminderEmail,
} from "@/emails/billing-emails";
import {
  PAYMENT_SUCCEEDED_SUBJECT,
  SUBSCRIPTION_CANCELLED_SUBJECT,
  TRIAL_DOWNGRADED_SUBJECT,
  TRIAL_REMINDER_1D_SUBJECT,
  TRIAL_REMINDER_30D_SUBJECT,
  TRIAL_REMINDER_7D_SUBJECT,
  paymentFailedSubject,
  trialConvertedSubject,
} from "@/lib/notifications/email";
import { eventNoticeSubject, reminderSubject } from "@/lib/notifications/dispatch";

/**
 * Every email the app sends, in each of its variants, with sample data: the
 * preview gallery (scripts/email-previews.ts; spec: docs/specs/email-upgrade.md §5).
 * Subjects and wording come from the same functions the senders use.
 */

export type EmailSample = {
  /** The gallery section. */
  group: string;
  /** A stable file name. */
  name: string;
  /** What this scenario is, for the reviewer. */
  title: string;
  subject: string;
  /** Who it's from. */
  brand: EmailBrand;
  render: () => Promise<RenderedEmail>;
};

export const SAMPLE_GROUPS = [
  "Invitations",
  "Schedule changes",
  "Reminders",
  "Account",
  "Club",
  "Team",
  "Billing",
] as const;

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

const PACIFIC = "America/Los_Angeles";
const EVENT_URL = `${APP}/dashboard/schedule/sample`;

// An away game with everything filled in, headed "12U Girls @ Rivals FC".
const GAME = {
  eventTitle: "Saturday game",
  eventType: "game",
  startTime: "2026-10-03T17:00:00Z",
  endTime: "2026-10-03T18:30:00Z",
  location: "Damon-Garcia Sports Fields",
  teamName: "12U Girls",
  arrivalTime: 45,
  eventUrl: EVENT_URL,
  timeZone: PACIFIC,
  opponent: "Rivals FC",
  homeAway: "away",
  uniform: { name: "Navy", color: "#1e3a8a" },
  notes: "Bring both jerseys. Parking is behind the south field.",
};
const GAME_TITLE = gameTitle(
  { title: GAME.eventTitle, event_type: GAME.eventType, opponent: GAME.opponent, home_away: GAME.homeAway },
  GAME.teamName,
  { includeScore: false }
);

/** Answer rows as the senders build them: links to the event page, per person (spec §4.7). */
function answerRows(rows: Array<Omit<AnswerRow, "links">>): AnswerRow[] {
  return rows.map((row) => ({
    ...row,
    links: {
      available: `${EVENT_URL}?answer=available&for=${row.profileId}`,
      maybe: `${EVENT_URL}?answer=maybe&for=${row.profileId}`,
      unavailable: `${EVENT_URL}?answer=unavailable&for=${row.profileId}`,
    },
  }));
}

// A guardian of two players: Ava has answered, Zoey hasn't.
const GUARDIAN = answerRows([
  { profileId: "ava", name: "Ava", isRecipient: false, status: "available" },
  { profileId: "zoey", name: "Zoey", isRecipient: false, status: null },
]);
// A player (or coach) with their own login, answering for themselves.
const SELF_MAYBE = answerRows([{ profileId: "me", name: "Sam", isRecipient: true, status: "maybe" }]);
const SELF_UNANSWERED = answerRows([{ profileId: "me", name: "Sam", isRecipient: true, status: null }]);

const PRACTICE = {
  eventTitle: "Tuesday practice",
  eventType: "practice",
  startTime: "2026-09-29T23:30:00Z",
  endTime: "2026-09-30T01:00:00Z",
  location: null,
  teamName: "Rec Soccer",
  arrivalTime: null,
  eventUrl: EVENT_URL,
  timeZone: PACIFIC,
};

function clubNotice(notice: ClubNotice & { footer?: string }, brand: EmailBrand) {
  return renderClubNoticeEmail({
    heading: notice.heading,
    paragraphs: notice.paragraphs,
    cta: notice.cta,
    footer: notice.footer ?? OWNERSHIP_NOTICE_FOOTER,
    brand,
  });
}

export function emailSamples(club: EmailBrand = sampleClub()): EmailSample[] {
  const offer = transferOfferNotice({ clubName: "SLOFC", fromName: "Olive Owner", url: `${APP}/dashboard/club` });
  const declined = transferDeclinedNotice({ clubName: "SLOFC", toName: "Dana Director" });
  const accepted = ownershipChangedNotice({ clubName: "SLOFC", nextName: "Dana Director", how: "accepted" });
  const recovered = ownershipChangedNotice({ clubName: "SLOFC", nextName: "Dana Director", how: "recovered" });
  const closed = clubClosedNotice({ clubName: "SLOFC", firstName: "Ava" });
  // What the series editor sends with a move from Tuesdays 4:00 to Wednesdays
  // 5:00 at a new park: its own summary, as the coach confirmed it (PR #96 review).
  const seriesMove = [
    { field: "Location", before: "Islay Park", after: "Sinsheimer Park" },
    { field: "Time", before: "4:00 PM – 5:30 PM PDT", after: "5:00 PM – 6:30 PM PDT" },
    {
      field: "Recurrence",
      before: "Every week on Tuesday",
      after: "Every week on Wednesday",
    },
  ];
  const billing = `${APP}/dashboard/club/billing`;
  const upgrade = `${APP}/dashboard/club/upgrade`;

  return [
    // ── Invitations ─────────────────────────────────────────────────────────
    {
      group: "Invitations",
      name: "invite-player-club",
      title: "Player invitation, club team",
      subject: "You've been invited to join 12U Girls on SLOFC",
      brand: club,
      render: () =>
        renderInviteEmail({ teamName: "12U Girls", inviterName: "Sam Okafor", role: "player", inviteUrl: `${APP}/invite/sample`, brand: club }),
    },
    {
      group: "Invitations",
      name: "invite-player-lista",
      title: "Player invitation, team outside a club",
      subject: "You've been invited to join Rec Soccer on Lista",
      brand: LISTA_BRAND,
      render: () =>
        renderInviteEmail({ teamName: "Rec Soccer", inviterName: "Sam Okafor", role: "player", inviteUrl: `${APP}/invite/sample`, brand: LISTA_BRAND }),
    },
    {
      group: "Invitations",
      name: "invite-coach-club",
      title: "Coach invitation, club team",
      subject: "You've been invited to join 12U Girls on SLOFC",
      brand: club,
      render: () =>
        renderInviteEmail({ teamName: "12U Girls", inviterName: "Olive Owner", role: "coach", inviteUrl: `${APP}/invite/sample`, brand: club }),
    },
    {
      group: "Invitations",
      name: "invite-guardian-club",
      title: "Guardian invitation, for a player on the team",
      subject: "You've been invited to join 12U Girls on SLOFC",
      brand: club,
      // Stored with the role "manager" (BUG-012); the email says Guardian.
      render: () =>
        renderInviteEmail({
          teamName: "12U Girls",
          inviterName: "Sam Okafor",
          role: "manager",
          guardianOf: "Ava",
          inviteUrl: `${APP}/invite/sample`,
          brand: club,
        }),
    },
    {
      group: "Invitations",
      name: "invite-director",
      title: "Director invitation (joins the club)",
      subject: "You've been invited to help run SLOFC on SLOFC",
      brand: club,
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

    // ── Schedule changes ────────────────────────────────────────────────────
    {
      group: "Schedule changes",
      name: "event-created-game-guardian",
      title: "New game, to a guardian of two players: a row each, one answered",
      subject: eventNoticeSubject("created", GAME_TITLE),
      brand: club,
      render: () => renderEventEmail({ ...GAME, action: "created", answers: GUARDIAN, brand: club }),
    },
    {
      group: "Schedule changes",
      name: "event-created-practice-lista",
      title: "New practice, to a player, not answered yet; no location or arrival time",
      subject: eventNoticeSubject("created", PRACTICE.eventTitle),
      brand: LISTA_BRAND,
      render: () => renderEventEmail({ ...PRACTICE, action: "created", answers: SELF_UNANSWERED, brand: LISTA_BRAND }),
    },
    {
      group: "Schedule changes",
      name: "event-updated-game-guardian",
      title: "Game moved an hour later: old time struck through, and \"still good?\"",
      subject: eventNoticeSubject("updated", GAME_TITLE),
      brand: club,
      render: () =>
        renderEventEmail({
          ...GAME,
          action: "updated",
          previous: {
            startTime: "2026-10-03T16:00:00Z",
            endTime: "2026-10-03T17:30:00Z",
            arrivalTime: 45,
            location: "Damon-Garcia Sports Fields",
          },
          answers: GUARDIAN,
          brand: club,
        }),
    },
    {
      group: "Schedule changes",
      name: "event-updated-game-no-previous",
      title: "Game updated, from a notice queued before part 2 (no previous values)",
      subject: eventNoticeSubject("updated", GAME_TITLE),
      brand: club,
      render: () => renderEventEmail({ ...GAME, action: "updated", answers: SELF_MAYBE, brand: club }),
    },
    {
      group: "Schedule changes",
      name: "event-restored-practice-lista",
      title: "Cancelled practice back on, to a player who'd said Maybe",
      subject: eventNoticeSubject("restored", PRACTICE.eventTitle),
      brand: LISTA_BRAND,
      render: () => renderEventEmail({ ...PRACTICE, action: "restored", answers: SELF_MAYBE, brand: LISTA_BRAND }),
    },
    {
      group: "Schedule changes",
      name: "event-cancelled-game-club",
      title: "Game cancelled (or deleted): details struck through, no answers",
      subject: eventNoticeSubject("cancelled", GAME_TITLE),
      brand: club,
      render: () => renderEventEmail({ ...GAME, action: "cancelled", answers: GUARDIAN, brand: club }),
    },
    {
      group: "Schedule changes",
      name: "series-updated-club",
      title: "A series moved: 12 practices from Tuesdays 4:00 to Wednesdays 5:00, at a new park",
      subject: eventNoticeSubject("updated", "Tuesday practice", 12),
      brand: club,
      render: () =>
        renderSeriesUpdateEmail({
          eventTitle: "Tuesday practice",
          teamName: "12U Girls",
          occurrences: 12,
          changes: seriesMove,
          scheduleUrl: `${APP}/dashboard/schedule`,
          brand: club,
        }),
    },
    {
      group: "Schedule changes",
      name: "series-updated-no-previous",
      title: "A series changed, from a notice queued before part 2 (no previous values)",
      subject: eventNoticeSubject("updated", "Tuesday practice", 12),
      brand: club,
      render: () =>
        renderSeriesUpdateEmail({
          eventTitle: "Tuesday practice",
          teamName: "12U Girls",
          occurrences: 12,
          changes: [],
          scheduleUrl: `${APP}/dashboard/schedule`,
          brand: club,
        }),
    },

    // ── Reminders ───────────────────────────────────────────────────────────
    {
      group: "Reminders",
      name: "reminder-game-guardian",
      title: "Game tomorrow, to a guardian of two players",
      subject: reminderSubject(GAME_TITLE, "tomorrow", "Sat, Oct 3"),
      brand: club,
      render: () => renderEventEmail({ ...GAME, action: "reminder", answers: GUARDIAN, brand: club }),
    },
    {
      group: "Reminders",
      name: "reminder-game-coach",
      title: "Game tomorrow, to a coach answering for themselves",
      subject: reminderSubject(GAME_TITLE, "tomorrow", "Sat, Oct 3"),
      brand: club,
      render: () => renderEventEmail({ ...GAME, action: "reminder", answers: SELF_MAYBE, brand: club }),
    },
    {
      group: "Reminders",
      name: "reminder-practice-lista",
      title: "Practice today, team outside a club, not answered yet",
      subject: reminderSubject(PRACTICE.eventTitle, "today", "Tue, Sep 29"),
      brand: LISTA_BRAND,
      render: () => renderEventEmail({ ...PRACTICE, action: "reminder", answers: SELF_UNANSWERED, brand: LISTA_BRAND }),
    },

    // ── Account ─────────────────────────────────────────────────────────────
    {
      group: "Account",
      name: "confirmation-club",
      title: "Confirm your account, signed up on a club's site",
      subject: "Confirm your SLOFC account",
      brand: club,
      render: () => renderConfirmationEmail({ confirmUrl: `${APP}/auth/confirm?sample`, firstName: "Ava", brand: club }),
    },
    {
      group: "Account",
      name: "confirmation-lista",
      title: "Confirm your account, signed up on lista.team",
      subject: "Confirm your Lista account",
      brand: LISTA_BRAND,
      render: () => renderConfirmationEmail({ confirmUrl: `${APP}/auth/confirm?sample`, brand: LISTA_BRAND }),
    },

    // ── Club ────────────────────────────────────────────────────────────────
    {
      group: "Club",
      name: "club-ownership-offer",
      title: "Offered ownership of the club (to a director)",
      subject: offer.subject,
      brand: club,
      render: () => clubNotice(offer, club),
    },
    {
      group: "Club",
      name: "club-ownership-declined",
      title: "Ownership offer declined (to the owner)",
      subject: declined.subject,
      brand: club,
      render: () => clubNotice(declined, club),
    },
    {
      group: "Club",
      name: "club-ownership-accepted",
      title: "Ownership accepted (to the previous owner)",
      subject: accepted.subject,
      brand: club,
      render: () => clubNotice(accepted, club),
    },
    {
      group: "Club",
      name: "club-ownership-recovered",
      title: "Ownership moved by support (to the previous owner)",
      subject: recovered.subject,
      brand: club,
      render: () => clubNotice(recovered, club),
    },
    {
      group: "Club",
      name: "club-closed",
      title: "Club closed (to every member; a closed club is usually back to lista's brand)",
      subject: closed.subject,
      brand: LISTA_BRAND,
      render: () => clubNotice(closed, LISTA_BRAND),
    },

    // ── Team ────────────────────────────────────────────────────────────────
    {
      group: "Team",
      name: "team-deleted",
      title: "Team deleted (to its members)",
      subject: "12U Girls has been deleted",
      brand: LISTA_BRAND,
      render: () => renderTeamDeletionEmail({ teamName: "12U Girls" }),
    },

    // ── Billing ─────────────────────────────────────────────────────────────
    ...(
      [
        ["billing-trial-30-days", "Trial reminder, 30 days left", TRIAL_REMINDER_30D_SUBJECT, "2026-10-28T00:00:00Z"],
        ["billing-trial-7-days", "Trial reminder, 7 days left", TRIAL_REMINDER_7D_SUBJECT, "2026-10-05T00:00:00Z"],
        ["billing-trial-1-day", "Trial reminder, ends tomorrow", TRIAL_REMINDER_1D_SUBJECT, "2026-09-29T00:00:00Z"],
      ] as const
    ).map(
      ([name, title, subject, trialEndsAt]): EmailSample => ({
        group: "Billing",
        name,
        title,
        subject,
        brand: LISTA_BRAND,
        render: () => renderTrialReminderEmail({ orgName: "SLOFC", subject, trialEndsAt, manageBillingUrl: billing }),
      })
    ),
    {
      group: "Billing",
      name: "billing-trial-converted-small",
      title: "Trial converted to Club Small",
      subject: trialConvertedSubject("club_small"),
      brand: LISTA_BRAND,
      render: () => renderTrialConvertedEmail({ orgName: "SLOFC", tier: "club_small", manageBillingUrl: billing }),
    },
    {
      group: "Billing",
      name: "billing-trial-converted-large",
      title: "Trial converted to Club Large",
      subject: trialConvertedSubject("club_large"),
      brand: LISTA_BRAND,
      render: () => renderTrialConvertedEmail({ orgName: "SLOFC", tier: "club_large", manageBillingUrl: billing }),
    },
    {
      group: "Billing",
      name: "billing-trial-downgraded",
      title: "Trial ended with no card: moved to Free",
      subject: TRIAL_DOWNGRADED_SUBJECT,
      brand: LISTA_BRAND,
      render: () => renderTrialDowngradedEmail({ orgName: "SLOFC", upgradeUrl: upgrade }),
    },
    {
      group: "Billing",
      name: "billing-payment-succeeded",
      title: "Payment succeeded",
      subject: PAYMENT_SUCCEEDED_SUBJECT,
      brand: LISTA_BRAND,
      render: () => renderPaymentSucceededEmail({ orgName: "SLOFC", manageBillingUrl: billing }),
    },
    {
      group: "Billing",
      name: "billing-payment-failed",
      title: "Payment failed",
      subject: paymentFailedSubject("SLOFC"),
      brand: LISTA_BRAND,
      render: () => renderPaymentFailedEmail({ orgName: "SLOFC", manageBillingUrl: billing }),
    },
    {
      group: "Billing",
      name: "billing-subscription-cancelled",
      title: "Subscription cancelled: moved to Free",
      subject: SUBSCRIPTION_CANCELLED_SUBJECT,
      brand: LISTA_BRAND,
      render: () => renderSubscriptionCancelledEmail({ orgName: "SLOFC", upgradeUrl: upgrade }),
    },
  ];
}
