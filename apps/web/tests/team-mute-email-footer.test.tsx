/**
 * Every team notice's footer offers to mute that team
 * (docs/specs/team-notification-controls.md §3.4, D11).
 *
 * Both links go to Settings, signed in: "Mute [Team]" with that team
 * highlighted, and "manage your notification settings" to the tab itself.
 * There is no one-click unsubscribe yet (D11).
 */

import { describe, it, expect } from "vitest";
import { renderEventEmail } from "@/emails/event-email";
import { renderSeriesUpdateEmail } from "@/emails/series-update-email";
import { renderTournamentEmail } from "@/emails/tournament-email";
import { LISTA_BRAND } from "@/emails/brand";
import { notificationSettingsLinks } from "@/lib/notifications/settings-links";

const APP = "https://app.example";
const TEAM_ID = "11111111-2222-3333-4444-555555555555";
const SETTINGS = notificationSettingsLinks(APP, TEAM_ID);
const MUTE_HREF = `href="${APP}/dashboard/settings?tab=notifications&amp;team=${TEAM_ID}"`;
const MANAGE_HREF = `href="${APP}/dashboard/settings?tab=notifications"`;

const renders = {
  event: () =>
    renderEventEmail({
      eventTitle: "Training Session",
      eventType: "practice",
      startTime: "2026-05-01T17:00:00Z",
      endTime: "2026-05-01T18:30:00Z",
      location: "Riverside Park",
      teamName: "U12 Blue",
      action: "created",
      eventUrl: `${APP}/dashboard/schedule/e1`,
      timeZone: "America/Los_Angeles",
      brand: LISTA_BRAND,
      settings: SETTINGS,
    }),
  series: () =>
    renderSeriesUpdateEmail({
      eventTitle: "Practice",
      teamName: "U12 Blue",
      occurrences: 12,
      changes: [],
      brand: LISTA_BRAND,
      settings: SETTINGS,
    }),
  tournament: () =>
    renderTournamentEmail({
      brand: LISTA_BRAND,
      teamName: "U12 Blue",
      title: "Surf Cup",
      start_time: "2026-12-11T08:00:00.000Z",
      end_time: "2026-12-14T08:00:00.000Z",
      timeZone: "America/Los_Angeles",
      location: "Del Mar Fields",
      action: "created",
      url: `${APP}/dashboard/schedule/t-1`,
      settings: SETTINGS,
    }),
};

describe("the settings links", () => {
  it("point at the notifications tab, with the team to highlight", () => {
    expect(SETTINGS).toEqual({
      manageUrl: `${APP}/dashboard/settings?tab=notifications`,
      muteUrl: `${APP}/dashboard/settings?tab=notifications&team=${TEAM_ID}`,
    });
  });
});

describe.each(Object.entries(renders))("the %s email's footer", (_name, render) => {
  it("links to mute the team and to the notification settings", async () => {
    const { html, text } = await render();

    expect(html).toContain("Mute U12 Blue");
    expect(html).toContain(MUTE_HREF);
    expect(html).toContain(MANAGE_HREF);
    expect(text).toContain("Mute U12 Blue");
    expect(text).toContain(SETTINGS.muteUrl);
  });
});

describe("a footer without links", () => {
  it("keeps the old wording, for notices rendered without a team (samples, old jobs)", async () => {
    const { html } = await renderSeriesUpdateEmail({
      eventTitle: "Practice",
      teamName: "U12 Blue",
      occurrences: 12,
      changes: [],
      brand: LISTA_BRAND,
    });

    expect(html).toContain("You can manage your notification preferences in your account settings.");
    expect(html).not.toContain("Mute U12 Blue");
  });
});
