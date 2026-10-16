// @vitest-environment jsdom
/**
 * The device's context, read for real against a mocked database and cookie jar
 * (docs/specs/device-local-active-context.md, acceptance 1, 2, 4 and 5).
 *
 * Each "device" is its own cookie jar. The database's active_team_id is shared
 * by all of them, as it is in production.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const ME = "00000000-0000-4000-8000-000000000001";
const PARTNER = "00000000-0000-4000-8000-000000000005";
const DAUGHTER = "00000000-0000-4000-8000-000000000002";
const TEAMMATE = "00000000-0000-4000-8000-000000000009";
const CLUB = "10000000-0000-4000-8000-000000000001";
const REC = "10000000-0000-4000-8000-000000000002";

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  const db: Record<string, Row[]> = {};
  const failing = new Set<string>();
  const jar = { cookies: new Map<string, string>() };
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.order = () => chain;
    chain.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain);
    chain.neq = (c: string, v: unknown) => (filters.push((r) => r[c] !== v), chain);
    chain.in = (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), chain);
    const rows = () => (db[table] ?? []).filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }));
    const result = (one: boolean) =>
      Promise.resolve(
        failing.has(table)
          ? { data: null, error: { message: "timeout" } }
          : { data: one ? (rows()[0] ?? null) : rows(), error: null }
      );
    chain.single = () => result(true);
    chain.maybeSingle = () => result(true);
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result(false).then(res, rej);
    return chain;
  };
  return { db, failing, jar, client: { from } };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.cookies.has(name) ? { value: mocks.jar.cookies.get(name) } : undefined),
  }),
}));
// React's cache() would share results across these "requests"; each read here is its own.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: (fn: unknown) => fn }));

import { loadActiveContext, type ActiveContext } from "@/lib/active-context";
import { encodeContext } from "@/lib/active-context-cookie";

const team = (id: string) => ({ id, name: id === CLUB ? "Club" : "Rec", archived_at: null, organizations: null });

/** One child, on a club team and a rec team, managed by two guardians. */
function seed() {
  mocks.db.profiles = [
    { id: ME, active_team_id: null },
    { id: PARTNER, active_team_id: null },
    { id: DAUGHTER, active_team_id: REC },
    { id: TEAMMATE, active_team_id: CLUB },
  ];
  mocks.db.profile_managers = [
    { manager_id: ME, managed_id: DAUGHTER, relationship: "Dad", profiles: mocks.db.profiles[2] },
    { manager_id: PARTNER, managed_id: DAUGHTER, relationship: "Mom", profiles: mocks.db.profiles[2] },
  ];
  mocks.db.team_members = [
    { id: "m-1", profile_id: DAUGHTER, team_id: CLUB, role: "player", teams: team(CLUB), profiles: null },
    { id: "m-2", profile_id: DAUGHTER, team_id: REC, role: "player", teams: team(REC), profiles: null },
    { id: "m-3", profile_id: TEAMMATE, team_id: CLUB, role: "coach", teams: team(CLUB), profiles: null },
  ];
}

/** A device: its own cookie jar. Reads the context as `account` would on it. */
function device(saved?: { profileId: string; teamId: string; accountId?: string }) {
  const cookies = new Map<string, string>();
  if (saved) cookies.set("lista_context", encodeContext({ accountId: ME, ...saved }));
  return {
    cookies,
    async read(account = ME): Promise<ActiveContext> {
      mocks.jar.cookies = cookies;
      const context = await loadActiveContext(mocks.client as never, account);
      // What SaveActiveContext would then store on this device.
      if (context.save) cookies.set("lista_context", encodeContext(context.save));
      return context;
    },
  };
}

/** Another device, or guardian, switching: it writes the shared default. */
function pickElsewhere(profileId: string, teamId: string) {
  mocks.db.profiles.find((p) => p.id === profileId)!.active_team_id = teamId;
}

beforeEach(() => {
  for (const key of Object.keys(mocks.db)) delete mocks.db[key];
  mocks.failing.clear();
  seed();
});

describe("acceptance 1: two devices of one account, one child, different teams", () => {
  it("a switch on one doesn't move the other", async () => {
    const laptop = device({ profileId: DAUGHTER, teamId: CLUB });
    const phone = device({ profileId: DAUGHTER, teamId: REC });

    pickElsewhere(DAUGHTER, CLUB); // the laptop's switch records its default

    expect((await laptop.read()).activeMembership?.team_id).toBe(CLUB);
    expect((await phone.read()).activeMembership?.team_id).toBe(REC);
  });
});

describe("acceptance 2: two guardians of one child", () => {
  it("one guardian's switch leaves the other's context alone", async () => {
    const dad = device({ profileId: DAUGHTER, teamId: REC });
    const mom = device({ profileId: DAUGHTER, teamId: CLUB, accountId: PARTNER });

    pickElsewhere(DAUGHTER, CLUB);
    expect((await dad.read(ME)).activeMembership?.team_id).toBe(REC);

    pickElsewhere(DAUGHTER, REC);
    expect((await mom.read(PARTNER)).activeMembership?.team_id).toBe(CLUB);
  });
});

describe("acceptance 4: seeding", () => {
  it("a new device seeds from the last-picked team once, then keeps it", async () => {
    const tablet = device();

    const first = await tablet.read();
    expect([first.activeProfileId, first.activeMembership?.team_id]).toEqual([DAUGHTER, REC]);
    expect(first.save).toEqual({ accountId: ME, profileId: DAUGHTER, teamId: REC });

    pickElsewhere(DAUGHTER, CLUB);
    const later = await tablet.read();
    expect(later.activeMembership?.team_id).toBe(REC);
    expect(later.save).toBeNull();
  });

  it("the old profile cookie seeds the person", async () => {
    mocks.db.team_members.push({ id: "m-4", profile_id: ME, team_id: CLUB, role: "manager", teams: team(CLUB), profiles: null });
    const laptop = device();
    laptop.cookies.set("active_profile_id", DAUGHTER);

    expect((await laptop.read()).activeProfileId).toBe(DAUGHTER);
  });

  it("a failed read saves nothing, so it can't overwrite a good context", async () => {
    const laptop = device({ profileId: DAUGHTER, teamId: CLUB });
    mocks.failing.add("team_members");

    expect((await laptop.read()).save).toBeNull();
    expect(laptop.cookies.get("lista_context")).toBe(encodeContext({ accountId: ME, profileId: DAUGHTER, teamId: CLUB }));
  });
});

describe("acceptance 5: no forgery", () => {
  it("a tuple naming a teammate's profile acts as no one but the account's own people", async () => {
    const laptop = device({ profileId: TEAMMATE, teamId: CLUB });

    const context = await laptop.read();
    expect(context.activeProfileId).not.toBe(TEAMMATE);
    expect(context.activeMembership?.profile_id).toBe(DAUGHTER);
  });

  it("another account's tuple is ignored", async () => {
    const shared = device({ profileId: DAUGHTER, teamId: CLUB, accountId: PARTNER });

    const context = await shared.read(ME);
    expect(context.activeMembership?.team_id).toBe(REC);
    expect(context.save?.accountId).toBe(ME);
  });
});

// ── The layout asks to save only when it must ────────────────────────────────

describe("the dashboard layout", () => {
  afterEach(cleanup);

  async function renderLayout() {
    vi.resetModules();
    vi.doMock("next/headers", () => ({
      headers: async () => ({ get: () => null }),
      cookies: async () => ({
        get: (name: string) => (mocks.jar.cookies.has(name) ? { value: mocks.jar.cookies.get(name) } : undefined),
      }),
    }));
    vi.doMock("next/navigation", () => ({ redirect: vi.fn() }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ ...mocks.client, auth: { getUser: async () => ({ data: { user: { id: ME } } }) } }),
    }));
    vi.doMock("@/lib/supabase/tenant", () => ({ getTenantFromHeaders: () => null }));
    vi.doMock("@/components/ui/sonner", () => ({ Toaster: () => null }));
    vi.doMock("@/components/layout/dashboard-nav", () => ({ DashboardNav: () => null }));
    vi.doMock("@/components/layout/session-watch", () => ({ SessionWatch: () => null }));
    vi.doMock("@/components/layout/save-active-context", () => ({
      SaveActiveContext: ({ profileId, teamId }: { profileId: string; teamId: string }) => (
        <span data-testid="save">{`${profileId}/${teamId}`}</span>
      ),
    }));
    const { default: DashboardLayout } = await import("@/app/dashboard/layout");
    render(await DashboardLayout({ children: null }));
  }

  it("a device with no context asks to save the one chosen", async () => {
    mocks.jar.cookies = new Map();
    await renderLayout();

    expect(screen.getByTestId("save").textContent).toBe(`${DAUGHTER}/${REC}`);
  });

  it("a device with a valid context asks nothing", async () => {
    mocks.jar.cookies = new Map([["lista_context", encodeContext({ accountId: ME, profileId: DAUGHTER, teamId: CLUB })]]);
    await renderLayout();

    expect(screen.queryByTestId("save")).toBeNull();
  });
});
