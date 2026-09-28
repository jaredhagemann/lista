/**
 * Every email, on one layout (spec: docs/specs/email-upgrade.md, PR 1).
 *
 * The emails were hand-written HTML strings, one copy of the layout each, with
 * user text interpolated raw. They are now React Email templates on a shared
 * layout: user text is escaped by construction, every email has a plain-text
 * part, and a club team's emails carry the club's logo, name and secondary
 * color (D2) where lista's emails carry lista's.
 *
 * Wording is unchanged in this PR (D6); the richer event and invite content is
 * the second PR. These tests carry over what tests/unit/email.test.ts and
 * email-branding.test.ts guarded.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null }));
vi.mock("@/lib/resend", () => ({ getResend: () => ({ emails: { send: mockSend } }) }));

import {
  LISTA_BRAND,
  buttonTextColor,
  clubEmailBrand,
  tenantEmailBrand,
  type EmailBrand,
} from "@/emails/brand";
import { renderInviteEmail } from "@/emails/invite-email";
import { renderEventEmail } from "@/emails/event-email";
import { renderSeriesUpdateEmail } from "@/emails/series-update-email";
import { renderConfirmationEmail } from "@/emails/confirmation-email";
import { renderClubNoticeEmail } from "@/emails/club-notice-email";
import { renderTeamDeletionEmail } from "@/emails/team-deletion-email";
import {
  renderTrialReminderEmail,
  renderTrialConvertedEmail,
  renderTrialDowngradedEmail,
  renderPaymentSucceededEmail,
  renderPaymentFailedEmail,
  renderSubscriptionCancelledEmail,
} from "@/emails/billing-emails";
import { sendEmail } from "@/lib/notifications/email";
import { emailSamples } from "@/emails/samples";

beforeEach(() => mockSend.mockClear());

const CLUB_LOGO = "https://x.supabase.co/storage/v1/object/public/org-logos/slofc.png";
const TEAM_LOGO = "https://x.supabase.co/storage/v1/object/public/team-images/t1.png";
const SLOFC = {
  name: "San Luis Obispo FC",
  org_name_public: "SLOFC",
  logo_url: CLUB_LOGO,
  plan: "club_small",
  brand_color_secondary: "#C8102E",
};
const CLUB: EmailBrand = clubEmailBrand(SLOFC);

const INVITE = {
  teamName: "U12 Blue",
  inviterName: "Coach Sarah",
  role: "player",
  inviteUrl: "https://lista.team/invite/abc123",
};

const EVENT = {
  eventTitle: "Training Session",
  eventType: "practice",
  startTime: "2026-05-01T17:00:00Z",
  endTime: "2026-05-01T18:30:00Z",
  location: "Riverside Park",
  teamName: "U12 Blue",
  action: "created" as const,
  eventUrl: "https://lista.team/dashboard/schedule/e1",
  timeZone: "America/Los_Angeles",
};

// ── The brand ─────────────────────────────────────────────────────────────────

describe("the email brand", () => {
  it("a club: its public name, logo, secondary color, and its name as the sender", () => {
    expect(CLUB).toEqual({ name: "SLOFC", logoUrl: CLUB_LOGO, color: "#C8102E", fromName: "SLOFC" });
  });

  it("a club team's own logo comes first, as in the app", () => {
    expect(clubEmailBrand(SLOFC, TEAM_LOGO).logoUrl).toBe(TEAM_LOGO);
  });

  it("a club without a public name uses its internal name", () => {
    expect(clubEmailBrand({ ...SLOFC, org_name_public: null }).name).toBe("San Luis Obispo FC");
  });

  it("a club without a usable secondary color gets lista blue", () => {
    expect(clubEmailBrand({ ...SLOFC, brand_color_secondary: null }).color).toBe("#01D7F4");
    expect(clubEmailBrand({ ...SLOFC, brand_color_secondary: "red; x" }).color).toBe("#01D7F4");
  });

  it("anything that isn't a club gets lista", () => {
    expect(clubEmailBrand({ ...SLOFC, plan: "free" })).toEqual(LISTA_BRAND);
    expect(clubEmailBrand(null)).toEqual(LISTA_BRAND);
    expect(LISTA_BRAND).toEqual({ name: "Lista", logoUrl: "https://lista.team/email/lista-mark.png", color: "#01D7F4", fromName: null });
  });

  it("a signup on a club's site gets the club; elsewhere lista", () => {
    const tenant = {
      organizationId: "o1",
      slug: "slofc",
      plan: "club_small",
      brandColor: "#000000",
      brandColorSecondary: "#C8102E",
      logoUrl: CLUB_LOGO,
      faviconUrl: null,
      orgNamePublic: "SLOFC",
      subdomain: "slofc",
      isWhiteLabel: true,
    } as const;
    expect(tenantEmailBrand(tenant)).toEqual(CLUB);
    expect(tenantEmailBrand(null)).toEqual(LISTA_BRAND);
  });

  it("button text is dark on a light color and white on a dark one", () => {
    expect(buttonTextColor("#01D7F4")).toBe("#111827");
    expect(buttonTextColor("#C8102E")).toBe("#ffffff");
    expect(buttonTextColor("#fff")).toBe("#111827");
  });
});

// ── The layout ────────────────────────────────────────────────────────────────

describe("the layout", () => {
  it("a club's email shows its logo, and its button wears its color", async () => {
    const { html } = await renderInviteEmail({ ...INVITE, brand: CLUB });

    expect(html).toContain(`src="${CLUB_LOGO}"`);
    expect(html).toContain(`alt="SLOFC"`);
    expect(html).toMatch(/background-color:\s*#C8102E/i);
    expect(html).toMatch(/color:\s*#ffffff/i);
  });

  it("a club without a logo shows its name in the header", async () => {
    const { html } = await renderInviteEmail({ ...INVITE, brand: { ...CLUB, logoUrl: null } });

    expect(html).not.toContain("<img");
    expect(html).toContain("SLOFC");
  });

  it("lista's email shows the lista mark beside the wordmark, and a lista-blue button with dark text", async () => {
    const { html } = await renderInviteEmail({ ...INVITE, brand: LISTA_BRAND });

    expect(html).toContain(`src="https://lista.team/email/lista-mark.png"`);
    expect(html).toContain(">lista<");
    // The mark sits beside the name, so it's decoration: the name is already read out.
    expect(html).toMatch(/<img[^>]*alt=""/);
    expect(html).toMatch(/background-color:\s*#01D7F4/i);
    expect(html).toMatch(/color:\s*#111827/i);
  });

  it("has an inbox preview line", async () => {
    const { html } = await renderInviteEmail({ ...INVITE, brand: LISTA_BRAND });
    expect(html).toContain("Coach Sarah has invited you to join U12 Blue");
  });
});

// ── Plain text ────────────────────────────────────────────────────────────────

const EVERY_EMAIL: Array<[string, () => Promise<{ html: string; text: string }>, string]> = [
  ["invite", () => renderInviteEmail({ ...INVITE, brand: LISTA_BRAND }), INVITE.inviteUrl],
  ["event", () => renderEventEmail({ ...EVENT, brand: LISTA_BRAND }), EVENT.eventUrl],
  [
    "series update",
    () =>
      renderSeriesUpdateEmail({
        eventTitle: "Practice",
        teamName: "U12 Blue",
        changes: [{ field: "Time", before: "4:00 PM", after: "5:00 PM" }],
        brand: LISTA_BRAND,
      }),
    "5:00 PM",
  ],
  ["confirmation", () => renderConfirmationEmail({ confirmUrl: "https://c.test/ok", brand: LISTA_BRAND }), "https://c.test/ok"],
  [
    "club notice",
    () =>
      renderClubNoticeEmail({
        heading: "SLOFC has closed",
        paragraphs: ["It's closed."],
        cta: { label: "Open", url: "https://n.test/club" },
        footer: "Because.",
      }),
    "https://n.test/club",
  ],
  ["team deletion", () => renderTeamDeletionEmail({ teamName: "U12 Blue" }), "U12 Blue has been deleted"],
  [
    "trial reminder",
    () =>
      renderTrialReminderEmail({
        orgName: "Acme FC",
        subject: "7 days left",
        trialEndsAt: "2026-06-01T00:00:00Z",
        manageBillingUrl: "https://b.test/billing",
      }),
    "https://b.test/billing",
  ],
  [
    "trial converted",
    () => renderTrialConvertedEmail({ orgName: "Acme FC", tier: "club_small", manageBillingUrl: "https://b.test/billing" }),
    "https://b.test/billing",
  ],
  ["trial downgraded", () => renderTrialDowngradedEmail({ orgName: "Acme FC", upgradeUrl: "https://b.test/up" }), "https://b.test/up"],
  [
    "payment succeeded",
    () => renderPaymentSucceededEmail({ orgName: "Acme FC", manageBillingUrl: "https://b.test/billing" }),
    "https://b.test/billing",
  ],
  [
    "payment failed",
    () => renderPaymentFailedEmail({ orgName: "Acme FC", manageBillingUrl: "https://b.test/billing" }),
    "https://b.test/billing",
  ],
  [
    "subscription cancelled",
    () => renderSubscriptionCancelledEmail({ orgName: "Acme FC", upgradeUrl: "https://b.test/up" }),
    "https://b.test/up",
  ],
];

describe("every email has a plain-text part", () => {
  it.each(EVERY_EMAIL)("%s", async (_name, render, expected) => {
    const { html, text } = await render();

    expect(html).toMatch(/^<!DOCTYPE html/i);
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toMatch(/<[a-z]/i);
    expect(text).toContain(expected);
  });
});

// ── Escaping ──────────────────────────────────────────────────────────────────

const HOSTILE = `<b>Bold</b> & "quoted"`;

describe("user text is escaped, never rendered as markup", () => {
  it("event title, team name and location", async () => {
    const { html } = await renderEventEmail({
      ...EVENT,
      eventTitle: HOSTILE,
      teamName: HOSTILE,
      location: HOSTILE,
      brand: LISTA_BRAND,
    });
    expect(html).not.toContain("<b>Bold</b>");
    expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt;");
  });

  it("series changes", async () => {
    const { html } = await renderSeriesUpdateEmail({
      eventTitle: HOSTILE,
      teamName: "U12 Blue",
      changes: [{ field: "Location", before: HOSTILE, after: HOSTILE }],
      brand: LISTA_BRAND,
    });
    expect(html).not.toContain("<b>Bold</b>");
  });

  it("invitation: team and inviter names", async () => {
    const { html } = await renderInviteEmail({ ...INVITE, teamName: HOSTILE, inviterName: HOSTILE, brand: LISTA_BRAND });
    expect(html).not.toContain("<b>Bold</b>");
  });

  it("confirmation: first name", async () => {
    const { html } = await renderConfirmationEmail({ confirmUrl: "https://c.test", firstName: HOSTILE, brand: LISTA_BRAND });
    expect(html).not.toContain("<b>Bold</b>");
  });

  it("club notice: plain paragraphs and bold spans", async () => {
    const { html } = await renderClubNoticeEmail({
      heading: HOSTILE,
      paragraphs: [HOSTILE, [{ strong: HOSTILE }, " and more"]],
      footer: HOSTILE,
    });
    expect(html).not.toContain("<b>Bold</b>");
    expect(html).toContain("<strong>&lt;b&gt;Bold&lt;/b&gt;");
  });

  it("team deletion and billing: the team or club name", async () => {
    expect((await renderTeamDeletionEmail({ teamName: HOSTILE })).html).not.toContain("<b>Bold</b>");
    expect((await renderPaymentFailedEmail({ orgName: HOSTILE, manageBillingUrl: "https://b.test" })).html).not.toContain(
      "<b>Bold</b>"
    );
  });
});

// ── Content carried over ──────────────────────────────────────────────────────

describe("invitation", () => {
  it("has the team, inviter, role, and the invite URL as a button and a fallback link", async () => {
    const { html } = await renderInviteEmail({ ...INVITE, brand: LISTA_BRAND });

    expect(html).toContain("U12 Blue");
    expect(html).toContain("Coach Sarah");
    expect(html).toContain("Player");
    expect(html.match(/https:\/\/lista\.team\/invite\/abc123/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("a club's invitation names the club in the heading and footer, not Lista", async () => {
    const { html } = await renderInviteEmail({ ...INVITE, brand: CLUB });

    expect(html).toContain("invited to join a team on SLOFC");
    expect(html).not.toMatch(/on Lista/);
  });

  it("a director invitation asks you to help run the club", async () => {
    const { html } = await renderInviteEmail({ ...INVITE, role: "director", kind: "club", brand: CLUB });

    expect(html).toContain("help run");
    expect(html).toContain("as a director");
  });
});

describe("event", () => {
  it("shows the action, title, team, type, date and time in the team's zone, and location", async () => {
    const { html } = await renderEventEmail({ ...EVENT, brand: LISTA_BRAND });

    expect(html).toContain("New Event");
    expect(html).toContain("Training Session");
    expect(html).toContain("Practice");
    expect(html).toContain("Friday, May 1, 2026");
    expect(html).toContain("10:00 AM – 11:30 AM PDT");
    expect(html).toContain("Riverside Park");
    expect(html).toContain(EVENT.eventUrl);
  });

  it("shows when to arrive", async () => {
    const { html } = await renderEventEmail({ ...EVENT, arrivalTime: 30, brand: LISTA_BRAND });
    expect(html).toContain("Arrive by");
    expect(html).toContain("9:30 AM PDT");
  });

  it("a club team's footer names the club, not Lista", async () => {
    const { html } = await renderEventEmail({ ...EVENT, brand: CLUB });
    expect(html).toContain("member of U12 Blue on SLOFC");
    expect(html).not.toMatch(/on Lista/);
  });
});

describe("series update", () => {
  it("lists each change before and after", async () => {
    const { html } = await renderSeriesUpdateEmail({
      eventTitle: "Practice",
      teamName: "U12 Blue",
      changes: [{ field: "Time", before: "4:00 PM", after: "5:00 PM" }],
      brand: LISTA_BRAND,
    });
    expect(html).toContain("Schedule Updated");
    expect(html).toContain("4:00 PM");
    expect(html).toContain("5:00 PM");
  });

  it("says the schedule changed when there are no field changes", async () => {
    const { html } = await renderSeriesUpdateEmail({ eventTitle: "Practice", teamName: "U12 Blue", changes: [], brand: LISTA_BRAND });
    expect(html).toContain("The recurring schedule for this event has been updated.");
  });
});

describe("confirmation", () => {
  it("greets by name and names the platform in the body and footer", async () => {
    const { html } = await renderConfirmationEmail({ confirmUrl: "https://c.test", firstName: "Ava", brand: CLUB });
    expect(html).toContain("Hi Ava,");
    expect(html).toContain("Thanks for signing up for SLOFC!");
    expect(html).toContain("created an account on SLOFC");
    expect(html).not.toMatch(/Lista/);
  });

  it("defaults to Lista", async () => {
    const { html } = await renderConfirmationEmail({ confirmUrl: "https://c.test", brand: LISTA_BRAND });
    expect(html).toContain("Hi there,");
    expect(html).toContain("Thanks for signing up for Lista!");
  });
});

describe("team deletion", () => {
  it("says the team was permanently deleted, with no button", async () => {
    const { html } = await renderTeamDeletionEmail({ teamName: "U12 Blue" });
    expect(html).toContain("U12 Blue has been deleted");
    expect(html).toMatch(/permanently deleted/);
    expect(html).not.toContain("<a ");
  });
});

describe("club notice", () => {
  it("renders bold spans and the button", async () => {
    const { html } = await renderClubNoticeEmail({
      heading: "You've been offered ownership of SLOFC",
      paragraphs: [[{ strong: "Olive Owner" }, " would like you to become the owner."]],
      cta: { label: "Review the offer", url: "https://n.test/club" },
      footer: "You received this email because you're an owner or director of a club on Lista.",
    });
    expect(html).toContain("<strong>Olive Owner</strong>");
    expect(html).toContain("Review the offer");
    expect(html).toContain("https://n.test/club");
  });
});

describe("payment failed", () => {
  it("keeps its red button", async () => {
    const { html } = await renderPaymentFailedEmail({ orgName: "Acme FC", manageBillingUrl: "https://b.test" });
    expect(html).toMatch(/background-color:\s*#dc2626/i);
  });
});

// ── Sending ───────────────────────────────────────────────────────────────────

describe("sendEmail", () => {
  it("sends the plain-text part with the HTML", async () => {
    await sendEmail({ to: "a@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ html: "<p>Hi</p>", text: "Hi" }));
  });

  it("is from lista by default, and from the brand name when given", async () => {
    await sendEmail({ to: "a@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
    await sendEmail({ to: "a@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", brandName: "Joga FC" });

    expect(mockSend.mock.calls[0][0].from).toBe("lista <notifications@lista.team>");
    expect(mockSend.mock.calls[1][0].from).toBe("Joga FC <notifications@lista.team>");
  });
});

// ── Previews ──────────────────────────────────────────────────────────────────


describe("previews (scripts/email-previews.ts)", () => {
  it("there's a sample of every email, in a club's brand and lista's where it can carry either, and each renders", async () => {
    const samples = emailSamples();
    const names = samples.map((s) => s.name);

    for (const kind of ["invite", "event-reminder", "event-cancelled", "series-update", "confirmation"]) {
      expect(names).toContain(`${kind}-club`);
      expect(names).toContain(`${kind}-lista`);
    }
    for (const name of [
      "director-invite-club",
      "club-ownership-offer",
      "team-deleted",
      "billing-trial-reminder",
      "billing-trial-converted",
      "billing-trial-downgraded",
      "billing-payment-succeeded",
      "billing-payment-failed",
      "billing-subscription-cancelled",
    ]) {
      expect(names).toContain(name);
    }

    for (const sample of samples) {
      const { html, text } = await sample.render();
      expect(html.length, sample.name).toBeGreaterThan(500);
      expect(text.length, sample.name).toBeGreaterThan(20);
    }
  });
});
