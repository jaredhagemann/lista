/**
 * Unit tests for white-label email branding (Sprint 4)
 *
 * Covers:
 *   - buildInviteEmailHtml with brandName/logoUrl
 *   - buildEventEmailHtml with brandName/logoUrl
 *   - buildSeriesUpdateEmailHtml with brandName/logoUrl
 *   - sendEmail from-name overrides when brandName provided
 *   - Default (no branding) behaviour is unchanged
 *
 * Email builders are pure functions — no mocks needed for branding tests.
 * sendEmail tests mock Resend to inspect the `from` field.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Resend mock ───────────────────────────────────────────────────────────────

const mockSend = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null }));

vi.mock("@/lib/resend", () => ({
  getResend: vi.fn().mockReturnValue({ emails: { send: mockSend } }),
}));

import {
  buildInviteEmailHtml,
  buildEventEmailHtml,
  buildSeriesUpdateEmailHtml,
  buildConfirmationEmailHtml,
  sendEmail,
} from "@/lib/notifications/email";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const BASE_INVITE_PARAMS = {
  teamName: "U12 Blue",
  inviterName: "Coach Sarah",
  role: "player",
  inviteUrl: "https://lista.team/invite/abc123",
};

const BASE_EVENT_PARAMS = {
  eventTitle: "Training Session",
  eventType: "training",
  startTime: new Date("2026-05-01T10:00:00Z").toISOString(),
  endTime: new Date("2026-05-01T11:00:00Z").toISOString(),
  location: "Riverside Park",
  teamName: "U12 Blue",
  action: "created" as const,
};

beforeEach(() => {
  mockSend.mockClear();
});

// ── buildInviteEmailHtml — white-label branding ───────────────────────────────

describe("buildInviteEmailHtml — white-label branding", () => {
  it("shows club name in the header when brandName is provided", () => {
    const html = buildInviteEmailHtml({ ...BASE_INVITE_PARAMS, brandName: "Joga FC" });
    expect(html).toContain("Joga FC");
  });

  it("shows club logo img when logoUrl is provided", () => {
    const html = buildInviteEmailHtml({
      ...BASE_INVITE_PARAMS,
      brandName: "Joga FC",
      logoUrl: "https://cdn.example.com/logo.png",
    });
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
    expect(html).toContain("Joga FC");
  });

  it("omits 'Lista' from the footer when brandName is provided", () => {
    const html = buildInviteEmailHtml({ ...BASE_INVITE_PARAMS, brandName: "Joga FC" });
    // Footer should say "on Joga FC" not "on Lista"
    expect(html.toLowerCase()).not.toContain("on lista");
    expect(html).toContain("Joga FC");
  });

  it("uses lista wordmark when no brandName is provided (default)", () => {
    const html = buildInviteEmailHtml(BASE_INVITE_PARAMS);
    expect(html.toLowerCase()).toContain("lista");
  });

  it("does not render an img tag when no logoUrl is provided", () => {
    const html = buildInviteEmailHtml({ ...BASE_INVITE_PARAMS, brandName: "Joga FC" });
    // Header should be text, not an img
    expect(html).not.toContain('<img src="http');
  });
});

// ── buildEventEmailHtml — white-label branding ────────────────────────────────

describe("buildEventEmailHtml — white-label branding", () => {
  it("shows club name in the header when brandName is provided", () => {
    const html = buildEventEmailHtml({ ...BASE_EVENT_PARAMS, brandName: "Joga FC" });
    expect(html).toContain("Joga FC");
  });

  it("shows club logo img when logoUrl is provided", () => {
    const html = buildEventEmailHtml({
      ...BASE_EVENT_PARAMS,
      logoUrl: "https://cdn.example.com/logo.png",
    });
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
  });

  it("omits 'Lista' from the footer when brandName is provided", () => {
    const html = buildEventEmailHtml({ ...BASE_EVENT_PARAMS, brandName: "Joga FC" });
    expect(html.toLowerCase()).not.toContain("on lista");
    expect(html).toContain("Joga FC");
  });

  it("uses lista branding by default", () => {
    const html = buildEventEmailHtml(BASE_EVENT_PARAMS);
    expect(html.toLowerCase()).toContain("lista");
  });
});

// ── buildSeriesUpdateEmailHtml — white-label branding ────────────────────────

describe("buildSeriesUpdateEmailHtml — white-label branding", () => {
  const BASE_PARAMS = {
    eventTitle: "Weekly Training",
    teamName: "U12 Blue",
    changes: [{ field: "Location", before: "Park", after: "Gym" }],
  };

  it("shows club name in the header when brandName is provided", () => {
    const html = buildSeriesUpdateEmailHtml({ ...BASE_PARAMS, brandName: "Joga FC" });
    expect(html).toContain("Joga FC");
  });

  it("shows club logo img when logoUrl is provided", () => {
    const html = buildSeriesUpdateEmailHtml({
      ...BASE_PARAMS,
      logoUrl: "https://cdn.example.com/logo.png",
    });
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
  });

  it("omits 'Lista' from the footer when brandName is provided", () => {
    const html = buildSeriesUpdateEmailHtml({ ...BASE_PARAMS, brandName: "Joga FC" });
    expect(html.toLowerCase()).not.toContain("on lista");
  });
});

// ── buildConfirmationEmailHtml — white-label branding ────────────────────────

describe("buildConfirmationEmailHtml — white-label branding", () => {
  const BASE_PARAMS = {
    confirmUrl: "https://lista.team/auth/confirm?token=abc",
    firstName: "Jane",
  };

  it("shows club name in the header when brandName is provided", () => {
    const html = buildConfirmationEmailHtml({ ...BASE_PARAMS, brandName: "Joga FC" });
    expect(html).toContain("Joga FC");
  });

  it("shows club logo img when logoUrl is provided", () => {
    const html = buildConfirmationEmailHtml({
      ...BASE_PARAMS,
      brandName: "Joga FC",
      logoUrl: "https://cdn.example.com/logo.png",
    });
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
  });

  it("uses brandName in the body copy", () => {
    const html = buildConfirmationEmailHtml({ ...BASE_PARAMS, brandName: "Joga FC" });
    expect(html).toContain("signing up for Joga FC");
  });

  it("uses brandName in the footer", () => {
    const html = buildConfirmationEmailHtml({ ...BASE_PARAMS, brandName: "Joga FC" });
    expect(html).toContain("created an account on Joga FC");
  });

  it("omits 'Lista' from body and footer when brandName is provided", () => {
    const html = buildConfirmationEmailHtml({ ...BASE_PARAMS, brandName: "Joga FC" });
    expect(html.toLowerCase()).not.toContain("signing up for lista");
    expect(html.toLowerCase()).not.toContain("account on lista");
  });

  it("defaults to Lista branding when no brandName is provided", () => {
    const html = buildConfirmationEmailHtml(BASE_PARAMS);
    expect(html.toLowerCase()).toContain("lista");
  });
});

// ── sendEmail — from-name override ───────────────────────────────────────────

describe("sendEmail — from-name", () => {
  it("uses 'lista' as the from-name by default", async () => {
    await sendEmail({ to: "user@example.com", subject: "Test", html: "<p>Hi</p>" });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.stringContaining("lista") })
    );
  });

  it("uses the brandName as the from-name when provided", async () => {
    await sendEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Hi</p>",
      brandName: "Joga FC",
    });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.stringContaining("Joga FC") })
    );
  });

  it("does not use 'lista' as the display name when brandName overrides it", async () => {
    await sendEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Hi</p>",
      brandName: "Joga FC",
    });
    const fromArg: string = mockSend.mock.calls[0][0].from;
    // from is "Joga FC <notifications@lista.team>" — display name must not be "lista"
    const displayName = fromArg.split("<")[0].trim();
    expect(displayName.toLowerCase()).not.toBe("lista");
    expect(displayName).toBe("Joga FC");
  });
});
