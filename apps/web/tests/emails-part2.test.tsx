/**
 * Email upgrade, part 2: richer event and invitation emails
 * (spec: docs/specs/email-upgrade.md §4.3, §4.4, §4.7; D7–D10).
 *
 * - A game is headed "12U Girls vs Rivals FC", with home/away, uniform and notes.
 * - An update strikes through what changed; a cancellation strikes through the
 *   details; an event back on says so.
 * - Each person the recipient answers for gets a row: their current answer and
 *   the Available / Maybe / Unavailable links (the app's own words), the current
 *   one filled in. A guardian's copy says who it's for.
 * - A guardian invitation says "Guardian", not the "manager" role it's stored with.
 */

import { describe, it, expect } from "vitest";
import { renderEventEmail, type AnswerRow } from "@/emails/event-email";
import { renderInviteEmail } from "@/emails/invite-email";
import { LISTA_BRAND, clubEmailBrand } from "@/emails/brand";

const CLUB = clubEmailBrand({ name: "San Luis Obispo FC", org_name_public: "SLOFC", logo_url: null, plan: "club_small", brand_color_secondary: "#C8102E" });

const EVENT_URL = "https://lista.team/dashboard/schedule/e1";

const GAME = {
  eventTitle: "Saturday game",
  eventType: "game",
  startTime: "2026-10-03T17:00:00Z",
  endTime: "2026-10-03T18:30:00Z",
  location: "Damon-Garcia Sports Fields",
  teamName: "12U Girls",
  arrivalTime: 45,
  eventUrl: EVENT_URL,
  timeZone: "America/Los_Angeles",
  opponent: "Rivals FC",
  homeAway: "away",
  uniform: { name: "Navy", color: "#1e3a8a" },
  notes: "Bring both jerseys.",
  brand: CLUB,
};

const PRACTICE = {
  eventTitle: "Tuesday practice",
  eventType: "practice",
  startTime: "2026-09-29T23:30:00Z",
  endTime: "2026-09-30T01:00:00Z",
  location: null,
  teamName: "Rec Soccer",
  eventUrl: EVENT_URL,
  timeZone: "America/Los_Angeles",
  brand: LISTA_BRAND,
};

function answers(url: string, rows: Array<Omit<AnswerRow, "links">>): AnswerRow[] {
  return rows.map((row) => ({
    ...row,
    links: {
      available: `${url}?answer=available&for=${row.profileId}`,
      maybe: `${url}?answer=maybe&for=${row.profileId}`,
      unavailable: `${url}?answer=unavailable&for=${row.profileId}`,
    },
  }));
}

const GUARDIAN_ROWS = answers(EVENT_URL, [
  { profileId: "ava", name: "Ava", isRecipient: false, status: "available" },
  { profileId: "zoey", name: "Zoey", isRecipient: false, status: null },
]);

// ── Games ─────────────────────────────────────────────────────────────────────

describe("a game", () => {
  it("is headed by team and opponent: @ away, vs at home", async () => {
    expect((await renderEventEmail({ ...GAME, action: "created" })).html).toContain("12U Girls @ Rivals FC");
    expect((await renderEventEmail({ ...GAME, homeAway: "home", action: "created" })).html).toContain("12U Girls vs Rivals FC");
  });

  it("shows home or away, the uniform with its color, and the notes", async () => {
    const { html, text } = await renderEventEmail({ ...GAME, action: "created" });

    expect(text).toMatch(/Home\/Away\s+Away/);
    expect(text).toMatch(/Uniform\s+Navy/);
    expect(html).toMatch(/background-color:\s*#1e3a8a/i);
    expect(text).toContain("Bring both jerseys.");
  });

  it("cuts long notes short", async () => {
    const { text } = await renderEventEmail({ ...GAME, notes: "x".repeat(400), action: "created" });
    expect(text).toContain(`${"x".repeat(279)}…`);
    expect(text).not.toContain("x".repeat(281));
  });

  it("without an opponent keeps its own title", async () => {
    const { html } = await renderEventEmail({ ...GAME, opponent: null, action: "created" });
    expect(html).toContain("Saturday game");
  });
});

describe("a practice", () => {
  it("keeps its title and names the team, with no game rows", async () => {
    const { text } = await renderEventEmail({ ...PRACTICE, action: "created" });

    expect(text).toContain("Tuesday practice");
    expect(text).toMatch(/Team\s+Rec Soccer/);
    expect(text).not.toMatch(/Uniform|Home\/Away/);
  });
});

// ── Changes ───────────────────────────────────────────────────────────────────

describe("an updated event", () => {
  it("shows the new time with the old one struck through, and leaves unchanged rows alone", async () => {
    const { html } = await renderEventEmail({
      ...GAME,
      action: "updated",
      previous: { startTime: "2026-10-03T16:00:00Z", endTime: "2026-10-03T17:30:00Z", arrivalTime: 45, location: "Damon-Garcia Sports Fields" },
    });

    expect(html).toContain("10:00 AM – 11:30 AM PDT");
    expect(html).toMatch(/text-decoration:\s*line-through[^>]*>9:00 AM – 10:30 AM PDT/);
    expect(html).not.toMatch(/line-through[^>]*>Damon-Garcia Sports Fields/);
  });

  it("without the previous values, just shows the event", async () => {
    const { html } = await renderEventEmail({ ...GAME, action: "updated" });
    expect(html).not.toContain("line-through");
  });
});

describe("a cancelled event", () => {
  it("strikes the details through and offers no answers", async () => {
    const { html, text } = await renderEventEmail({ ...GAME, action: "cancelled", answers: GUARDIAN_ROWS });

    expect(html).toContain("Event Cancelled");
    expect(html).toMatch(/line-through[^>]*>10:00 AM – 11:30 AM PDT/);
    expect(text).not.toContain("answer=available");
  });
});

describe("an event back on", () => {
  it("says so", async () => {
    const { html } = await renderEventEmail({ ...PRACTICE, action: "restored" });
    expect(html).toContain("Back On");
  });
});

// ── Answers (D7–D10) ──────────────────────────────────────────────────────────

describe("answering from the email", () => {
  it("a guardian's copy says who it's for, with a row per player and their current answer", async () => {
    const { html, text } = await renderEventEmail({ ...GAME, action: "reminder", answers: GUARDIAN_ROWS });

    expect(text).toContain("For Ava and Zoey");
    expect(text).toMatch(/Ava\s+✓ Available/);
    expect(text).toMatch(/Zoey\s+No answer yet/);
    for (const status of ["available", "maybe", "unavailable"]) {
      expect(html).toContain(`${EVENT_URL}?answer=${status}&amp;for=ava`);
      expect(html).toContain(`${EVENT_URL}?answer=${status}&amp;for=zoey`);
    }
  });

  it("fills in the current answer and outlines the others", async () => {
    const { html } = await renderEventEmail({ ...GAME, action: "reminder", answers: GUARDIAN_ROWS });

    const link = (status: string, who: string) =>
      html.match(new RegExp(`<a[^>]*href="[^"]*answer=${status}&amp;for=${who}"[^>]*>`))![0];
    expect(link("available", "ava")).toMatch(/background-color:\s*#16a34a/i);
    expect(link("maybe", "ava")).not.toMatch(/background-color:\s*#f59e0b/i);
    expect(link("available", "zoey")).not.toMatch(/background-color:\s*#16a34a/i);
  });

  it("the recipient's own row is theirs: 'You', and no 'For' line", async () => {
    const { text } = await renderEventEmail({
      ...GAME,
      action: "reminder",
      answers: answers(EVENT_URL, [{ profileId: "coach", name: "Sam", isRecipient: true, status: "maybe" }]),
    });

    expect(text).toMatch(/You\s+\? Maybe/);
    expect(text).not.toContain("For ");
  });

  it("without answer rows, there is no availability section", async () => {
    const { text } = await renderEventEmail({ ...GAME, action: "reminder" });
    expect(text).not.toMatch(/Availability|No answer yet/);
  });
});

// ── Invitations (§4.4) ────────────────────────────────────────────────────────

describe("an invitation", () => {
  const INVITE = { teamName: "12U Girls", inviterName: "Sam Okafor", inviteUrl: "https://lista.team/invite/abc" };

  it("is headed 'Join [team] on [brand]', with no emoji", async () => {
    const { html, text } = await renderInviteEmail({ ...INVITE, role: "player", brand: CLUB });

    expect(html).toContain("Join 12U Girls on SLOFC");
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("a guardian invitation says Guardian and whose, not Manager", async () => {
    const { html, text } = await renderInviteEmail({ ...INVITE, role: "manager", guardianOf: "Ava", brand: CLUB });

    expect(html).toContain(">Guardian<");
    expect(html).not.toContain(">Manager<");
    expect(text).toContain("as Ava's guardian");
  });

  it("a director invitation asks you to help run the club", async () => {
    const { html } = await renderInviteEmail({ ...INVITE, teamName: "SLOFC", role: "director", kind: "club", brand: CLUB });
    expect(html).toContain("Help run SLOFC");
  });
});

// ── Wording: one section title (2026-09-28) ───────────────────────────────────

describe("the availability section's title", () => {
  it("is 'Availability' on every event email that has one", async () => {
    for (const action of ["created", "updated", "restored", "reminder"] as const) {
      const { text } = await renderEventEmail({ ...GAME, action, answers: GUARDIAN_ROWS });
      expect(text, action).toContain("Availability");
      expect(text, action).not.toMatch(/still good|can you make it/i);
    }
  });
});

// ── A series changed: what changed (2026-09-28) ──────────────────────────────

import { seriesChanges, type EventSnapshot } from "@/lib/notifications/dispatch";
import { renderSeriesUpdateEmail } from "@/emails/series-update-email";

const PACIFIC = "America/Los_Angeles";
// Tuesday 4:00–5:30 PM Pacific at Islay Park, arrive 30 min early.
const TUESDAY: EventSnapshot = {
  title: "Tuesday practice",
  event_type: "practice",
  start_time: "2026-09-29T23:00:00Z",
  end_time: "2026-09-30T00:30:00Z",
  arrival_time: 30,
  location_id: "loc-islay",
  location_name: "Islay Park",
  is_cancelled: false,
  timezone: PACIFIC,
};

describe("seriesChanges", () => {
  it("names a new day of the week, as a recurring day", () => {
    const wednesday = { ...TUESDAY, start_time: "2026-09-30T23:00:00Z", end_time: "2026-10-01T00:30:00Z" };
    expect(seriesChanges(TUESDAY, wednesday, PACIFIC)).toEqual([{ field: "Day", before: "Tuesdays", after: "Wednesdays" }]);
  });

  it("shows a new time or length as the time of day, with the zone", () => {
    const later = { ...TUESDAY, start_time: "2026-09-30T00:00:00Z", end_time: "2026-09-30T01:30:00Z" };
    const longer = { ...TUESDAY, end_time: "2026-09-30T01:00:00Z" };

    expect(seriesChanges(TUESDAY, later, PACIFIC)).toEqual([
      { field: "Time", before: "4:00 PM – 5:30 PM PDT", after: "5:00 PM – 6:30 PM PDT" },
    ]);
    expect(seriesChanges(TUESDAY, longer, PACIFIC)).toEqual([
      { field: "Time", before: "4:00 PM – 5:30 PM PDT", after: "4:00 PM – 6:00 PM PDT" },
    ]);
  });

  it("shows a new location and arrival time", () => {
    const moved = { ...TUESDAY, location_id: "loc-sinsheimer", location_name: "Sinsheimer Park", arrival_time: 45 };
    expect(seriesChanges(TUESDAY, moved, PACIFIC)).toEqual([
      { field: "Arrive", before: "30 min early", after: "45 min early" },
      { field: "Location", before: "Islay Park", after: "Sinsheimer Park" },
    ]);
  });

  it("says 'None' where there was or is nothing", () => {
    const noPlace = { ...TUESDAY, location_id: null, location_name: null, arrival_time: null };
    expect(seriesChanges(TUESDAY, noPlace, PACIFIC)).toEqual([
      { field: "Arrive", before: "30 min early", after: "None" },
      { field: "Location", before: "Islay Park", after: "None" },
    ]);
  });

  it("is empty when nothing it describes changed, or there's no previous version", () => {
    expect(seriesChanges(TUESDAY, { ...TUESDAY, title: "Renamed" }, PACIFIC)).toEqual([]);
    expect(seriesChanges(undefined, TUESDAY, PACIFIC)).toEqual([]);
  });
});

describe("the series email", () => {
  it("says how many events changed, lists each change, and links to the schedule", async () => {
    const { html, text } = await renderSeriesUpdateEmail({
      eventTitle: "Tuesday practice",
      teamName: "12U Girls",
      occurrences: 12,
      changes: [{ field: "Day", before: "Tuesdays", after: "Wednesdays" }],
      scheduleUrl: "https://lista.team/dashboard/schedule",
      brand: CLUB,
    });

    expect(text).toContain("12 events in this series changed");
    expect(text).toMatch(/Day\s+Tuesdays\s+Wednesdays/);
    expect(html).toContain('href="https://lista.team/dashboard/schedule"');
  });

  it("without the details, still says how many events changed", async () => {
    const { text } = await renderSeriesUpdateEmail({
      eventTitle: "Tuesday practice",
      teamName: "12U Girls",
      occurrences: 12,
      changes: [],
      brand: CLUB,
    });

    expect(text).toContain("12 events in this series changed");
    expect(text).not.toMatch(/Before\s+After/);
  });
});
