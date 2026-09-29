/**
 * Schedule emails carry the team's brand (spec: docs/specs/email-upgrade.md §4.2).
 *
 * Reminders and change notices always said "lista", even for a club team whose
 * invitations were branded. The reminder cron and the notification worker now
 * load the team's club and send in its name, with its logo and color, and every
 * email goes with its plain-text part. A template given the right brand can't
 * notice a sender that never looks it up, so these run the senders.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.TZ = "UTC";
  const tables: Record<string, unknown> = {};
  const jobs: unknown[] = [];
  const selects: Array<{ table: string; columns: string }> = [];
  // Queries resolve to the table's rows, filtered by eq and in like the real
  // thing, so each recipient's own people come back and nobody else's.
  const from = vi.fn((table: string) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const rows = () => {
      const data = tables[table] ?? null;
      return Array.isArray(data) ? data.filter((row) => filters.every((f) => f(row))) : data;
    };
    const result = () => Promise.resolve({ data: rows(), error: null });
    const written = () => Promise.resolve({ data: null, error: null });
    const chain: Record<string, unknown> = {
      single: result,
      maybeSingle: result,
      insert: written,
      update: () => chain,
      select: (columns: string) => {
        selects.push({ table, columns });
        return chain;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => !(column in row) || row[column] === value);
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => !(column in row) || values.includes(row[column]));
        return chain;
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    for (const method of ["neq", "gte", "lte", "order", "limit"]) chain[method] = () => chain;
    return chain;
  });
  const rpc = vi.fn(async () => ({ data: jobs.splice(0), error: null }));
  return {
    tables,
    jobs,
    selects,
    from,
    rpc,
    sendEmail: vi.fn(async () => undefined),
  };
});

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({ from: mocks.from })) }));
vi.mock("@/lib/api-auth", () => ({ adminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/notifications/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/email")>()),
  sendEmail: mocks.sendEmail,
}));
vi.mock("@/lib/notifications/push", () => ({ sendPushNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/expo-push", () => ({ sendExpoPushNotification: vi.fn(async () => undefined) }));

import { GET as runReminders } from "@/app/api/cron/reminders/route";
import { drainNotificationJobs } from "@/lib/notifications/worker";

const PACIFIC = "America/Los_Angeles";
const CLUB_LOGO = "https://x.supabase.co/storage/v1/object/public/org-logos/slofc.png";
const SLOFC = {
  name: "San Luis Obispo FC",
  org_name_public: "SLOFC",
  logo_url: CLUB_LOGO,
  plan: "club_small",
  brand_color_secondary: "#C8102E",
};
const FREE_ORG = { name: "Rec", org_name_public: null, logo_url: null, plan: "free", brand_color_secondary: null };

function teamOf(organizations: unknown) {
  return { name: "12U Girls", timezone: PACIFIC, logo_url: null, organizations };
}

const PRACTICE = {
  id: "evt-1",
  team_id: "team-1",
  title: "Practice",
  event_type: "practice",
  start_time: "2026-09-17T23:00:00.000Z",
  end_time: "2026-09-18T00:30:00.000Z",
  arrival_time: null,
  timezone: PACIFIC,
  locations: { name: "Islay Park" },
};

function configureRecipients() {
  mocks.tables.team_members = [{ profile_id: "p1", profiles: { email: "parent@example.com", auth_user_id: "u1" } }];
  mocks.tables.profiles = [{ id: "p1", email: "parent@example.com", auth_user_id: "u1" }];
  mocks.tables.profile_managers = [];
  mocks.tables.notification_preferences = [];
  mocks.tables.push_subscriptions = [];
}

type Sent = { subject: string; html: string; text: string; brandName?: string | null };
function sent(): Sent {
  return (mocks.sendEmail.mock.calls[0] as unknown as [Sent])[0];
}

async function remind() {
  await runReminders(new Request("http://localhost/api/cron/reminders", { headers: { authorization: "Bearer secret" } }));
}

function queueChange() {
  mocks.jobs.push({
    id: "job-1",
    team_id: "team-1",
    event_id: "evt-1",
    action: "updated",
    kind: "event",
    occurrence_count: 1,
    attempts: 1,
    recipient_profile_ids: null,
    snapshot: {
      title: "Practice",
      event_type: "practice",
      start_time: PRACTICE.start_time,
      end_time: PRACTICE.end_time,
      timezone: PACIFIC,
      arrival_time: null,
      location_id: null,
      location_name: "Islay Park",
      is_cancelled: false,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.selects.length = 0;
  vi.stubEnv("CRON_SECRET", "secret");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-17T15:00:00.000Z"));
  configureRecipients();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the reminder cron", () => {
  it("asks for the team's club branding", async () => {
    mocks.tables.events = [{ ...PRACTICE, teams: teamOf(SLOFC) }];
    await remind();

    const query = mocks.selects.find((s) => s.table === "events");
    expect(query?.columns).toMatch(/organizations\(/);
    for (const column of ["org_name_public", "logo_url", "plan", "brand_color_secondary"]) {
      expect(query?.columns).toContain(column);
    }
  });

  it("sends a club team's reminder in the club's name, logo and color, with a plain-text part", async () => {
    mocks.tables.events = [{ ...PRACTICE, teams: teamOf(SLOFC) }];
    await remind();

    expect(sent().brandName).toBe("SLOFC");
    expect(sent().html).toContain(`src="${CLUB_LOGO}"`);
    expect(sent().html).toMatch(/background-color:\s*#C8102E/i);
    expect(sent().text).toContain("4:00 PM – 5:30 PM PDT");
  });

  it("sends a free team's reminder as lista", async () => {
    mocks.tables.events = [{ ...PRACTICE, teams: teamOf(FREE_ORG) }];
    await remind();

    expect(sent().brandName ?? null).toBeNull();
    expect(sent().html).toContain('src="https://www.lista.team/email/lista-mark.png"');
    expect(sent().text).toContain("Practice");
  });
});

describe("the notification worker", () => {
  it("sends a club team's change notice in the club's name and logo, with a plain-text part", async () => {
    mocks.tables.teams = teamOf(SLOFC);
    queueChange();

    await drainNotificationJobs();

    const query = mocks.selects.find((s) => s.table === "teams");
    expect(query?.columns).toMatch(/organizations\(/);
    expect(sent().brandName).toBe("SLOFC");
    expect(sent().html).toContain(`src="${CLUB_LOGO}"`);
    expect(sent().text).toContain("Event Updated");
  });

  it("sends a free team's change notice as lista", async () => {
    mocks.tables.teams = teamOf(FREE_ORG);
    queueChange();

    await drainNotificationJobs();

    expect(sent().brandName ?? null).toBeNull();
  });
});

// ── Part 2: each recipient's own email (spec §4.3, §4.7, D7–D11) ─────────────

describe("part 2: what each recipient's email carries", () => {
  // A guardian of two players (Ava has answered, Zoey hasn't) and a coach.
  function configureFamily() {
    mocks.tables.team_members = [
      { team_id: "team-1", profile_id: "ava" },
      { team_id: "team-1", profile_id: "zoey" },
      { team_id: "team-1", profile_id: "coach" },
    ];
    mocks.tables.profiles = [
      { id: "ava", first_name: "Ava", email: null, auth_user_id: null },
      { id: "zoey", first_name: "Zoey", email: null, auth_user_id: null },
      { id: "gail", first_name: "Gail", email: "gail@example.com", auth_user_id: "u-gail" },
      { id: "coach", first_name: "Sam", email: "sam@example.com", auth_user_id: "u-sam" },
    ];
    mocks.tables.profile_managers = [
      { managed_id: "ava", manager_id: "gail" },
      { managed_id: "zoey", manager_id: "gail" },
    ];
    mocks.tables.availability = [{ event_id: "evt-1", profile_id: "ava", status: "available" }];
    mocks.tables.notification_preferences = [];
    mocks.tables.push_subscriptions = [];
  }

  const TEAM = {
    ...teamOf(SLOFC),
    home_uniform: "Navy",
    home_uniform_color: "#1e3a8a",
    away_uniform: "White",
    away_uniform_color: "#ffffff",
  };
  const GAME = {
    ...PRACTICE,
    title: "Saturday game",
    event_type: "game",
    opponent: "Rivals FC",
    home_away: "away",
    uniform: "home",
    notes: "Bring both jerseys.",
  };
  const GAME_SNAPSHOT = {
    title: "Saturday game",
    event_type: "game",
    start_time: PRACTICE.start_time,
    end_time: PRACTICE.end_time,
    timezone: PACIFIC,
    arrival_time: 30,
    location_id: "islay",
    location_name: "Islay Park",
    is_cancelled: false,
    opponent: "Rivals FC",
    home_away: "away",
    uniform: "home",
    notes: "Bring both jerseys.",
  };

  function sentTo(address: string): Sent {
    const call = (mocks.sendEmail.mock.calls as unknown as Array<[Sent & { to: string }]>).find(([m]) => m.to === address);
    expect(call, `an email to ${address}`).toBeTruthy();
    return call![0];
  }

  function queue(job: Record<string, unknown>) {
    mocks.jobs.push({
      id: "job-2",
      team_id: "team-1",
      event_id: "evt-1",
      kind: "event",
      occurrence_count: 1,
      attempts: 1,
      recipient_profile_ids: null,
      ...job,
    });
  }

  beforeEach(() => {
    configureFamily();
    mocks.tables.teams = TEAM;
  });

  describe("the reminder", () => {
    beforeEach(async () => {
      mocks.tables.events = [{ ...GAME, teams: TEAM }];
      await remind();
    });

    it("gives a guardian a row per player, with each one's answer and links", () => {
      const email = sentTo("gail@example.com");

      expect(email.subject).toBe("Reminder: 12U Girls @ Rivals FC today");
      expect(email.text).toContain("For Ava and Zoey");
      expect(email.text).toMatch(/Ava\s+✓ Available/);
      expect(email.text).toMatch(/Zoey\s+No answer yet/);
      expect(email.html).toContain("/dashboard/schedule/evt-1?answer=available&amp;for=ava");
      expect(email.html).toContain("/dashboard/schedule/evt-1?answer=unavailable&amp;for=zoey");
      expect(email.html).not.toContain("for=coach");
    });

    it("gives a coach their own row, and nobody else's", () => {
      const email = sentTo("sam@example.com");

      expect(email.text).toMatch(/You\s+No answer yet/);
      expect(email.text).not.toContain("For ");
      expect(email.html).toContain("for=coach");
      expect(email.html).not.toContain("for=ava");
    });

    it("shows the game's details and the team's uniform", () => {
      const { text } = sentTo("gail@example.com");

      expect(text).toMatch(/Home\/Away\s+Away/);
      expect(text).toMatch(/Uniform\s+Navy/);
      expect(text).toContain("Bring both jerseys.");
    });
  });

  describe("a change notice", () => {
    it("an update strikes through the old time, and asks each person again", async () => {
      queue({
        action: "updated",
        snapshot: {
          ...GAME_SNAPSHOT,
          previous: { ...GAME_SNAPSHOT, start_time: "2026-09-17T22:00:00.000Z", end_time: "2026-09-17T23:30:00.000Z" },
        },
      });

      await drainNotificationJobs();

      const email = sentTo("gail@example.com");
      expect(email.subject).toBe("Updated: 12U Girls @ Rivals FC");
      expect(email.html).toMatch(/line-through[^>]*>3:00 PM – 4:30 PM PDT/);
      expect(email.text).toContain("Availability");
      expect(email.html).toContain("answer=maybe&amp;for=zoey");
    });

    it("a series change lists what changed", async () => {
      queue({
        action: "updated",
        event_id: null,
        occurrence_count: 3,
        snapshot: {
          ...GAME_SNAPSHOT,
          title: "Tuesday practice",
          event_type: "practice",
          previous: { ...GAME_SNAPSHOT, start_time: "2026-09-16T23:00:00.000Z", end_time: "2026-09-17T00:30:00.000Z" },
        },
      });

      await drainNotificationJobs();

      const { text, html } = sentTo("gail@example.com");
      expect(text).toContain("3 events in this series changed");
      expect(text).toMatch(/Day\s+Wednesdays\s+Thursdays/);
      expect(html).not.toContain("answer=");
    });

    it("a series edit lists the editor's summary: a move to another day reads as the recurrence", async () => {
      queue({
        action: "updated",
        event_id: "evt-1",
        occurrence_count: 3,
        snapshot: {
          ...GAME_SNAPSHOT,
          title: "Tuesday practice",
          event_type: "practice",
          series_changes: [{ field: "Recurrence", before: "Every week on Tuesday", after: "Every week on Wednesday" }],
        },
      });

      await drainNotificationJobs();

      const { subject, text, html } = sentTo("gail@example.com");
      expect(subject).toBe("Updated: Tuesday practice — 3 events");
      expect(text).toContain("3 events in this series changed");
      expect(text).toMatch(/Recurrence\s+Every week on Tuesday\s+Every week on Wednesday/);
      expect(html).not.toContain("answer=");
    });

    // An event from before event zones has none and goes by its team's (Pacific).
    // Moved to Mountain at the same wall-clock time, 4:00 PM (PR #96 re-review).
    const LEGACY_MOVE = {
      ...GAME_SNAPSHOT,
      start_time: "2026-09-17T22:00:00.000Z",
      end_time: "2026-09-17T23:30:00.000Z",
      timezone: "America/Denver",
      previous: { ...GAME_SNAPSHOT, timezone: null, start_time: "2026-09-17T23:00:00.000Z", end_time: "2026-09-18T00:30:00.000Z" },
    };

    it("an event with no zone of its own shows its previous time in its team's zone", async () => {
      queue({ action: "updated", snapshot: LEGACY_MOVE });

      await drainNotificationJobs();

      const { text } = sentTo("gail@example.com");
      expect(text).toContain("4:00 PM – 5:30 PM MDT");
      expect(text).toContain("Was 4:00 PM – 5:30 PM PDT");
      expect(text).not.toContain("5:00 PM – 6:30 PM MDT");
    });

    it("so does a bulk change to a series of them", async () => {
      queue({ action: "updated", event_id: null, occurrence_count: 3, snapshot: { ...LEGACY_MOVE, event_type: "practice" } });

      await drainNotificationJobs();

      expect(sentTo("gail@example.com").text).toMatch(/Time\s+4:00 PM – 5:30 PM PDT\s+4:00 PM – 5:30 PM MDT/);
    });

    it("a cancellation offers no answers", async () => {
      queue({ action: "cancelled", snapshot: { ...GAME_SNAPSHOT, is_cancelled: true } });

      await drainNotificationJobs();

      expect(sentTo("gail@example.com").html).not.toContain("answer=");
    });

    it("an event back on says so, and asks again", async () => {
      queue({ action: "restored", snapshot: GAME_SNAPSHOT });

      await drainNotificationJobs();

      const email = sentTo("gail@example.com");
      expect(email.html).toContain("Back On");
      expect(email.html).toContain("answer=available&amp;for=ava");
    });
  });
});
