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
  const from = vi.fn((table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, error: null });
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
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    for (const method of ["eq", "neq", "in", "gte", "lte"]) chain[method] = () => chain;
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
