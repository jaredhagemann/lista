/**
 * Tournament notices read as a tournament (docs/specs/tournaments-and-leagues.md
 * §4, "Notifications"; part 2c).
 *
 *   - one notice for a tournament-wide action, never the series template
 *   - dates, not midnight-to-midnight times, and the games it's about, each
 *     with its time and round, in the zone they were captured in
 *   - links and answer buttons by action: created, updated and restored link to
 *     the tournament with answers for it; cancelled links to it without them;
 *     deleted links to the schedule, since the tournament is gone
 *   - a single game's notice says "Part of Surf Cup · Semifinal"
 */

import { describe, it, expect } from "vitest";
import { renderTournamentEmail } from "@/emails/tournament-email";
import { renderEventEmail, type AnswerRow } from "@/emails/event-email";
import { LISTA_BRAND } from "@/emails/brand";
import {
  isTournamentSnapshot,
  tournamentNoticeUrl,
  tournamentPushBody,
  tournamentReminderSubject,
  partOfLine,
} from "@/lib/notifications/tournament-notice";
import type { NotificationJob } from "@/lib/notifications/dispatch";

const LA = "America/Los_Angeles";
const APP = "https://app.example";

// Fri Dec 11 – Sun Dec 13, 2026, Pacific.
const DAYS = { start_time: "2026-12-11T08:00:00.000Z", end_time: "2026-12-14T08:00:00.000Z" };

const GAMES = [
  {
    id: "g-1",
    title: "U10 Girls vs Rivals FC",
    start_time: "2026-12-11T17:00:00.000Z",
    end_time: "2026-12-11T18:30:00.000Z",
    timezone: LA,
    opponent: "Rivals FC",
    home_away: "home",
    round: "Pool A",
    is_cancelled: false,
  },
  {
    id: "g-2",
    title: "Final",
    start_time: "2026-12-13T22:00:00.000Z",
    end_time: "2026-12-13T23:30:00.000Z",
    timezone: LA,
    opponent: null,
    home_away: null,
    round: "Final",
    is_cancelled: false,
  },
];

function job(action: NotificationJob["action"], extra: Record<string, unknown> = {}): NotificationJob {
  return {
    id: "job-1",
    team_id: "team-1",
    event_id: "t-1",
    action,
    occurrence_count: 1,
    attempts: 1,
    snapshot: {
      title: "Surf Cup",
      event_type: "tournament",
      ...DAYS,
      timezone: LA,
      arrival_time: null,
      location_id: "loc-1",
      location_name: "Del Mar Fields",
      is_cancelled: action === "cancelled",
      ...extra,
    },
  } as NotificationJob;
}

const ANSWERS: AnswerRow[] = [
  {
    profileId: "p1",
    name: "Ava",
    isRecipient: true,
    status: null,
    links: {
      available: `${APP}/dashboard/schedule/t-1?answer=available&for=p1`,
      maybe: `${APP}/dashboard/schedule/t-1?answer=maybe&for=p1`,
      unavailable: `${APP}/dashboard/schedule/t-1?answer=unavailable&for=p1`,
    },
  },
];

function email(props: Partial<Parameters<typeof renderTournamentEmail>[0]> = {}) {
  return renderTournamentEmail({
    brand: LISTA_BRAND,
    teamName: "U10 Girls",
    title: "Surf Cup",
    ...DAYS,
    timeZone: LA,
    location: "Del Mar Fields",
    action: "created",
    games: { total: 2, action: "created", list: GAMES },
    url: `${APP}/dashboard/schedule/t-1`,
    ...props,
  });
}

describe("which jobs are tournaments", () => {
  it("by the snapshot's type, whatever the job's count", () => {
    expect(isTournamentSnapshot(job("created").snapshot)).toBe(true);
    expect(isTournamentSnapshot({ ...job("created").snapshot, event_type: "game" })).toBe(false);
  });
});

describe("where a tournament notice links", () => {
  it("created, updated, restored and cancelled link to the tournament", () => {
    for (const action of ["created", "updated", "restored", "cancelled"] as const) {
      expect(tournamentNoticeUrl(job(action), APP)).toBe(`${APP}/dashboard/schedule/t-1`);
    }
  });

  it("deleted links to the schedule: the tournament is gone", () => {
    expect(tournamentNoticeUrl(job("deleted"), APP)).toBe(`${APP}/dashboard/schedule`);
  });
});

describe("a tournament's push", () => {
  it("names its dates, games and place, never times", () => {
    const body = tournamentPushBody(
      job("created", { tournament: { games: 2, affected: 2, games_action: "created", affected_games: GAMES } }),
      LA
    );
    expect(body).toBe("Fri, Dec 11 – Sun, Dec 13 · 2 games — Del Mar Fields");
    expect(body).not.toMatch(/AM|PM/);
  });

  it("says what happened to its games", () => {
    const cancelled = job("cancelled", { tournament: { games: 3, affected: 2, games_action: "cancelled", affected_games: GAMES } });
    expect(tournamentPushBody(cancelled, LA)).toBe("Fri, Dec 11 – Sun, Dec 13 · its 2 remaining games are cancelled too");

    const kept = job("cancelled", { tournament: { games: 3, affected: 1, games_action: "kept", affected_games: [GAMES[0]] } });
    expect(tournamentPushBody(kept, LA)).toBe("Fri, Dec 11 – Sun, Dec 13 · 1 game stays on the schedule");

    const deleted = job("deleted", { tournament: { games: 2, affected: 2, games_action: "deleted", affected_games: GAMES } });
    expect(tournamentPushBody(deleted, LA)).toBe("Fri, Dec 11 – Sun, Dec 13 · removed with its 2 games");
  });

  it("an edit to the tournament alone, with no games summary, gives its dates and place", () => {
    expect(tournamentPushBody(job("updated"), LA)).toBe("Fri, Dec 11 – Sun, Dec 13 — Del Mar Fields");
  });
});

describe("a tournament's reminder subject", () => {
  it("says when it starts", () => {
    expect(tournamentReminderSubject("Surf Cup", "tomorrow", "tomorrow")).toBe("Reminder: Surf Cup starts tomorrow");
    expect(tournamentReminderSubject("Surf Cup", null, "Fri, Dec 11")).toBe("Reminder: Surf Cup starts Fri, Dec 11");
  });
});

describe("the tournament email", () => {
  it("created: its dates, place and games, each with its time and round, and answers for it", async () => {
    const { text, html } = await email({ answers: ANSWERS });

    expect(text).toContain("New Tournament");
    expect(text).toContain("Surf Cup");
    expect(text).toContain("Fri, Dec 11 – Sun, Dec 13");
    expect(text).toContain("Del Mar Fields");
    expect(text).toContain("2 games");
    expect(text).toContain("Fri, Dec 11 · 9:00 AM PST · U10 Girls vs Rivals FC · Pool A");
    expect(text).toContain("Sun, Dec 13 · 2:00 PM PST · Final");
    // Never as a midnight-to-midnight time range.
    expect(text).not.toContain("12:00 AM");
    expect(text).not.toMatch(/events in this series/);
    // Answers for the tournament.
    expect(html).toContain(`${APP}/dashboard/schedule/t-1?answer=available&amp;for=p1`);
    expect(text).toContain("View tournament");
  });

  it("updated: what changed about its days", async () => {
    const { text } = await email({
      action: "updated",
      games: undefined,
      previous: { start_time: "2026-12-12T08:00:00.000Z", end_time: "2026-12-14T08:00:00.000Z", location: "Del Mar Fields", timeZone: LA },
    });

    expect(text).toContain("Tournament Updated");
    expect(text).toContain("Fri, Dec 11 – Sun, Dec 13");
    expect(text).toMatch(/Was\s+Sat, Dec 12 – Sun, Dec 13/);
  });

  it("cancelled with its games: lists them, offers no answers, links to the tournament", async () => {
    const { text, html } = await email({
      action: "cancelled",
      games: { total: 3, action: "cancelled", list: GAMES },
      answers: ANSWERS,
    });

    expect(text).toContain("Tournament Cancelled");
    expect(text).toContain("Its 2 remaining games are cancelled too");
    expect(text).toContain("U10 Girls vs Rivals FC · Pool A");
    expect(html).not.toContain("answer=available");
    expect(text).toContain("View tournament");
  });

  it("cancelled keeping its games: says they stay on the schedule", async () => {
    const { text } = await email({ action: "cancelled", games: { total: 3, action: "kept", list: [GAMES[0]] } });

    expect(text).toContain("Its 1 remaining game stays on the schedule as a standalone game");
    expect(text).toContain("U10 Girls vs Rivals FC · Pool A");
  });

  it("deleted: links to the schedule, with no answers", async () => {
    const { text, html } = await email({
      action: "deleted",
      games: { total: 2, action: "deleted", list: GAMES },
      url: `${APP}/dashboard/schedule`,
      answers: ANSWERS,
    });

    expect(text).toContain("Tournament Cancelled");
    expect(text).toContain("removed from the schedule, with its 2 games");
    expect(text).toContain("View schedule");
    expect(html).toContain(`href="${APP}/dashboard/schedule"`);
    expect(html).not.toContain("/dashboard/schedule/t-1");
    expect(html).not.toContain("answer=available");
  });

  it("reminder: starts when, its games, and answers for it", async () => {
    const { text, html } = await email({ action: "reminder", games: { total: 2, action: "created", list: GAMES }, answers: ANSWERS });

    expect(text).toContain("Tournament Reminder");
    expect(text).toContain("2 games");
    expect(text).toContain("U10 Girls vs Rivals FC · Pool A");
    expect(html).toContain("answer=available");
  });

  it("a cancelled game in the list says so", async () => {
    const { text } = await email({ games: { total: 2, action: "created", list: [{ ...GAMES[0], is_cancelled: true }, GAMES[1]] } });

    expect(text).toContain("U10 Girls vs Rivals FC · Pool A (cancelled)");
  });
});

describe("a single game in a tournament", () => {
  it("says which tournament, and its round", async () => {
    expect(partOfLine({ tournament_title: "Surf Cup", round: "Semifinal" })).toBe("Part of Surf Cup · Semifinal");
    expect(partOfLine({ tournament_title: "Surf Cup", round: null })).toBe("Part of Surf Cup");
    expect(partOfLine({ tournament_title: null, round: "Semifinal" })).toBeNull();

    const { text } = await renderEventEmail({
      brand: LISTA_BRAND,
      eventTitle: "Semifinal",
      eventType: "game",
      startTime: "2026-12-12T17:00:00.000Z",
      endTime: "2026-12-12T18:30:00.000Z",
      location: null,
      teamName: "U10 Girls",
      action: "updated",
      timeZone: LA,
      opponent: "Eagles",
      homeAway: "away",
      partOf: "Part of Surf Cup · Semifinal",
    });
    expect(text).toContain("U10 Girls @ Eagles");
    expect(text).toContain("Part of Surf Cup · Semifinal");
  });
});
