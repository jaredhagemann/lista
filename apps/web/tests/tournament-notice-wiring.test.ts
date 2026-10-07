/**
 * The worker and the reminder cron send tournaments as tournaments
 * (docs/specs/tournaments-and-leagues.md §4, "Notifications", D6; part 2c).
 *
 * Until now a tournament job went out in the single-event template: "12:00 AM –
 * 12:00 AM", no games, and an answer link on a deleted tournament's dead page.
 * These run the real senders, with the database mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.TZ = "UTC";
  const tables: Record<string, unknown> = {};
  const jobs: unknown[] = [];
  /** How many reads of a tournament's games fail before one succeeds (TL-015). */
  const failures = { tournamentGames: 0 };
  const from = vi.fn((table: string) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    let readsTournamentGames = false;
    const rows = () => {
      const data = tables[table] ?? null;
      return Array.isArray(data) ? data.filter((row) => filters.every((f) => f(row))) : data;
    };
    const result = () => {
      if (readsTournamentGames && failures.tournamentGames > 0) {
        failures.tournamentGames--;
        return Promise.resolve({ data: null, error: { code: "57014", message: "statement timeout" } });
      }
      return Promise.resolve({ data: rows(), error: null });
    };
    const written = () => Promise.resolve({ data: null, error: null });
    const chain: Record<string, unknown> = {
      single: result,
      maybeSingle: result,
      insert: written,
      update: () => chain,
      delete: () => chain,
      select: () => chain,
      eq: (column: string, value: unknown) => {
        if (table === "events" && column === "tournament_id") readsTournamentGames = true;
        filters.push((row) => !(column in row) || row[column] === value);
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => !(column in row) || values.includes(row[column]));
        return chain;
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    for (const method of ["neq", "gte", "lte", "order", "limit", "is"]) chain[method] = () => chain;
    return chain;
  });
  const rpc = vi.fn(async () => ({ data: jobs.splice(0), error: null }));
  return {
    failures,
    tables,
    jobs,
    from,
    rpc,
    sendEmail: vi.fn(async () => undefined),
    sendExpo: vi.fn(async () => undefined),
  };
});

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({ from: mocks.from })) }));
vi.mock("@/lib/api-auth", () => ({ adminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/notifications/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/email")>()),
  sendEmail: mocks.sendEmail,
}));
vi.mock("@/lib/notifications/push", () => ({ sendPushNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/expo-push", () => ({
  sendExpoPushNotification: mocks.sendExpo,
  isDeadTokenError: () => false,
}));

import { GET as runReminders } from "@/app/api/cron/reminders/route";
import { drainNotificationJobs } from "@/lib/notifications/worker";

const LA = "America/Los_Angeles";
const APP = "https://app.example";
const TEAM = { name: "U10 Girls", timezone: LA, logo_url: null, organizations: null };

// Fri Dec 11 – Sun Dec 13, 2026, Pacific.
const DAYS = { start_time: "2026-12-11T08:00:00.000Z", end_time: "2026-12-14T08:00:00.000Z" };

const GAME_SUMMARIES = [
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

function queue(action: string, extra: Record<string, unknown> = {}, jobExtra: Record<string, unknown> = {}) {
  mocks.jobs.push({
    id: `job-${mocks.jobs.length + 1}`,
    team_id: "team-1",
    event_id: "t-1",
    action,
    kind: "event",
    occurrence_count: 1,
    attempts: 1,
    recipient_profile_ids: null,
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
    ...jobExtra,
  });
}

const tournamentSummary = (games_action: string, list = GAME_SUMMARIES, games = list.length) => ({
  tournament: { games, affected: list.length, games_action, affected_games: list },
});

type Sent = { subject: string; html: string; text: string };
const sentEmails = () => mocks.sendEmail.mock.calls.map((c) => (c as unknown as [Sent])[0]);
const sent = () => sentEmails()[0];
const pushed = () => (mocks.sendExpo.mock.calls[0] as unknown as [string, { title: string; body: string; url: string }])[1];

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.jobs.length = 0;
  mocks.failures.tournamentGames = 0;
  vi.stubEnv("CRON_SECRET", "secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-04T20:00:00.000Z"));
  mocks.tables.teams = TEAM;
  mocks.tables.team_members = [{ team_id: "team-1", profile_id: "p1" }];
  mocks.tables.profiles = [{ id: "p1", first_name: "Ava", email: "ava@example.com", auth_user_id: "u1" }];
  mocks.tables.profile_managers = [];
  mocks.tables.notification_preferences = [];
  mocks.tables.push_subscriptions = [{ profile_id: "p1", expo_push_token: "ExponentPushToken[test]" }];
  mocks.tables.availability = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the worker, for a tournament job", () => {
  it("created: the tournament template, its games, and answers for the tournament", async () => {
    queue("created", tournamentSummary("created"));
    await drainNotificationJobs();

    expect(sent().subject).toBe("New: Surf Cup");
    expect(sent().text).toContain("New Tournament");
    expect(sent().text).toContain("Fri, Dec 11 – Sun, Dec 13");
    expect(sent().text).toContain("Fri, Dec 11 · 9:00 AM PST · U10 Girls vs Rivals FC · Pool A");
    expect(sent().text).not.toContain("12:00 AM");
    expect(sent().html).toContain(`${APP}/dashboard/schedule/t-1?answer=available&amp;for=p1`);

    expect(pushed()).toEqual({
      title: "New: Surf Cup",
      body: "Fri, Dec 11 – Sun, Dec 13 · 2 games — Del Mar Fields",
      url: "/dashboard/schedule/t-1",
    });
  });

  it("never the series template, whatever the job's count", async () => {
    queue("updated", { previous: { ...DAYS, title: "Surf Cup", event_type: "tournament", timezone: LA, location_name: "Del Mar Fields" } }, { occurrence_count: 3 });
    await drainNotificationJobs();

    expect(sent().text).toContain("Tournament Updated");
    expect(sent().text).not.toMatch(/events in this series/);
    expect(sent().subject).toBe("Updated: Surf Cup");
  });

  it("cancelled: lists the games it took with it, links to the tournament, no answers", async () => {
    queue("cancelled", tournamentSummary("cancelled", GAME_SUMMARIES, 3));
    await drainNotificationJobs();

    expect(sent().text).toContain("Tournament Cancelled");
    expect(sent().text).toContain("Its 2 remaining games are cancelled too");
    expect(sent().html).toContain(`href="${APP}/dashboard/schedule/t-1"`);
    expect(sent().html).not.toContain("answer=");
    expect(pushed().url).toBe("/dashboard/schedule/t-1");
  });

  it("deleted: links to the schedule, not the tournament, with no answers", async () => {
    queue("deleted", tournamentSummary("deleted"));
    await drainNotificationJobs();

    expect(sent().text).toContain("removed from the schedule, with its 2 games");
    expect(sent().html).not.toContain("/dashboard/schedule/t-1");
    expect(sent().html).not.toContain("answer=");
    expect(pushed().url).toBe("/dashboard/schedule");
  });

  it("restored: back on, with answers for it", async () => {
    queue("restored");
    await drainNotificationJobs();

    expect(sent().subject).toBe("Back on: Surf Cup");
    expect(sent().text).toContain("Back On");
    expect(sent().html).toContain("answer=available");
  });
});

describe("the worker, for a game in a tournament", () => {
  it("names its tournament and round", async () => {
    mocks.jobs.push({
      id: "job-g",
      team_id: "team-1",
      event_id: "g-2",
      action: "updated",
      kind: "event",
      occurrence_count: 1,
      attempts: 1,
      recipient_profile_ids: null,
      snapshot: {
        title: "Final",
        event_type: "game",
        start_time: "2026-12-13T22:00:00.000Z",
        end_time: "2026-12-13T23:30:00.000Z",
        timezone: LA,
        arrival_time: null,
        location_id: null,
        location_name: null,
        is_cancelled: false,
        opponent: "Hawks",
        home_away: "home",
        round: "Final",
        tournament_id: "t-1",
        tournament_title: "Surf Cup",
      },
    });
    await drainNotificationJobs();

    expect(sent().subject).toBe("Updated: U10 Girls vs Hawks");
    expect(sent().text).toContain("Part of Surf Cup · Final");
    // Its own answers: an override for this game (spec §4, Notifications).
    expect(sent().html).toContain(`${APP}/dashboard/schedule/g-2?answer=available`);
  });
});

describe("the reminder cron", () => {
  const SURF_CUP = {
    id: "t-1",
    team_id: "team-1",
    title: "Surf Cup",
    event_type: "tournament",
    ...DAYS,
    timezone: LA,
    arrival_time: null,
    is_cancelled: false,
    tournament_id: null,
    round: null,
    opponent: null,
    home_away: null,
    uniform: null,
    notes: null,
    teams: TEAM,
    locations: { name: "Del Mar Fields" },
    tournament: null,
  };
  const GAMES = GAME_SUMMARIES.map((g) => ({ ...g, team_id: "team-1", tournament_id: "t-1", event_type: "game" }));

  async function remind() {
    return runReminders(new Request("http://localhost/api/cron/reminders", { headers: { authorization: "Bearer secret" } }));
  }

  it("reminds of a tournament the day before, as a tournament, with its games", async () => {
    // Thursday noon UTC: Surf Cup starts at midnight Friday, Pacific.
    vi.setSystemTime(new Date("2026-12-10T12:00:00.000Z"));
    mocks.tables.events = [SURF_CUP, ...GAMES.map((g) => ({ ...g, teams: TEAM, locations: null, uniform: null, notes: null, arrival_time: null }))];
    await remind();

    const reminder = sentEmails().find((e) => e.subject.includes("Surf Cup"))!;
    expect(reminder.subject).toBe("Reminder: Surf Cup starts tomorrow");
    expect(reminder.text).toContain("Tournament Reminder");
    expect(reminder.text).toContain("2 games");
    expect(reminder.text).toContain("U10 Girls vs Rivals FC · Pool A");
    expect(reminder.text).not.toContain("12:00 AM");

    const push = mocks.sendExpo.mock.calls
      .map((c) => (c as unknown as [string, { title: string; body: string }])[1])
      .find((p) => p.title.includes("Surf Cup"))!;
    expect(push).toMatchObject({ title: "Reminder: Surf Cup starts tomorrow", body: "2 games — Del Mar Fields" });
  });

  it("a game's reminder names its tournament", async () => {
    vi.setSystemTime(new Date("2026-12-11T12:00:00.000Z"));
    mocks.tables.events = [
      { ...GAMES[0], teams: TEAM, locations: null, uniform: null, notes: null, arrival_time: null, tournament: { title: "Surf Cup" } },
    ];
    await remind();

    expect(sent().text).toContain("Part of Surf Cup · Pool A");
  });

  // ── TL-015 (docs/reviews/2026-10-01-tournaments-and-leagues-review.md) ──

  describe("TL-015: a failed read of a tournament's games", () => {
    // A standalone practice in the same run, to show the rest still go out.
    const PRACTICE = {
      ...SURF_CUP,
      id: "p-1",
      title: "Practice",
      event_type: "practice",
      start_time: "2026-12-10T23:00:00.000Z",
      end_time: "2026-12-11T00:30:00.000Z",
      locations: null,
    };
    const gameRows = GAMES.map((g) => ({ ...g, teams: TEAM, locations: null, uniform: null, notes: null, arrival_time: null }));
    const pushTitles = () => mocks.sendExpo.mock.calls.map((c) => (c as unknown as [string, { title: string }])[1].title);

    beforeEach(() => {
      vi.setSystemTime(new Date("2026-12-10T12:00:00.000Z"));
    });

    it("is tried again once, and a read that then succeeds sends the whole reminder", async () => {
      mocks.tables.events = [SURF_CUP, ...gameRows];
      mocks.failures.tournamentGames = 1;
      const response = await remind();

      expect(response.status).toBe(200);
      const reminder = sentEmails().find((e) => e.subject === "Reminder: Surf Cup starts tomorrow")!;
      expect(reminder.text).toContain("2 games");
      expect(reminder.text).toContain("U10 Girls vs Rivals FC · Pool A");
    });

    it("that keeps failing sends no incomplete reminder, and the run reports it", async () => {
      mocks.tables.events = [SURF_CUP, PRACTICE];
      mocks.failures.tournamentGames = 2;
      const response = await remind();

      // Nothing about Surf Cup: not an email or a push without its schedule.
      expect(sentEmails().some((e) => e.subject.includes("Surf Cup"))).toBe(false);
      expect(pushTitles().some((t) => t.includes("Surf Cup"))).toBe(false);
      // The rest of the run still goes out, and queued notices are still sent.
      expect(sentEmails().some((e) => e.subject.startsWith("Reminder: Practice"))).toBe(true);
      expect(mocks.rpc).toHaveBeenCalledWith("claim_notification_jobs", expect.anything());
      // Visible to the cron's monitoring, with what failed.
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.failedEvents).toEqual([{ eventId: "t-1", error: "statement timeout" }]);
      expect(body.eventsProcessed).toBe(1);
    });

    it("a tournament with no games is still reminded, without them", async () => {
      mocks.tables.events = [SURF_CUP];
      const response = await remind();

      expect(response.status).toBe(200);
      const reminder = sentEmails().find((e) => e.subject === "Reminder: Surf Cup starts tomorrow")!;
      expect(reminder.text).not.toMatch(/\d games?/);
      expect(pushTitles()).toContain("Reminder: Surf Cup starts tomorrow");
    });
  });
});
