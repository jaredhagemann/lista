/**
 * Unit tests for setActiveTeam — redirect logic.
 *
 * Covers the four cases from docs/specs/club-subdomain-routing.md:
 *   1. Club team with active subdomain, on main domain → redirectUrl to subdomain
 *   2. Free/no-org team, on subdomain → redirectUrl to main domain
 *   3. Free/no-org team, on main domain → no redirectUrl
 *   4. Club team, already on correct subdomain → no redirectUrl (no redirect loop)
 *
 * Auth/membership logic is exercised minimally — the focus is the redirect
 * return value added in this feature.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const USER_ID = "user-uuid";
  const TEAM_ID = "team-uuid";
  const ORG_ID = "org-uuid";

  // Per-table results for from() queries
  const tableData: Record<string, unknown> = {};

  // Thenable chain supporting the query patterns used in setActiveTeam
  const makeChain = (val: unknown): Record<string, unknown> => {
    const promise = Promise.resolve({ data: val, error: null });
    const chain: Record<string, unknown> = {
      select: () => makeChain(val),
      eq: () => makeChain(val),
      in: () => makeChain(val),
      update: () => makeChain(val),
      single: () => promise,
      maybeSingle: () => promise,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        promise.then(res, rej),
    };
    return chain;
  };

  const mockFrom = vi.fn().mockImplementation((table: string) =>
    makeChain(tableData[table] ?? null)
  );

  const mockGetUser = vi.fn().mockResolvedValue({
    data: { user: { id: USER_ID } },
  });

  // Simulated current hostname; tests override this per case.
  let currentHost = "lista.team";
  const mockHeadersGet = vi.fn().mockImplementation((key: string) =>
    key === "host" ? currentHost : null
  );

  const mockCookiesSet = vi.fn();

  return {
    USER_ID,
    TEAM_ID,
    ORG_ID,
    tableData,
    mockFrom,
    mockGetUser,
    mockHeadersGet,
    mockCookiesSet,
    setHost: (h: string) => { currentHost = h; },
  };
});

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve({ get: mocks.mockHeadersGet }),
  cookies: () =>
    Promise.resolve({
      get: vi.fn().mockReturnValue(undefined),
      set: mocks.mockCookiesSet,
      delete: vi.fn(),
    }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mocks.mockGetUser },
      from: mocks.mockFrom,
    }),
}));

// Admin client (service role) — used only for the profiles.update call
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: mocks.mockFrom,
  }),
}));

vi.mock("@/lib/get-active-membership", () => ({
  getActiveProfileId: vi.fn(),
}));
vi.mock("@/lib/notifications/team-deletion", () => ({
  collectTeamDeletionRecipients: vi.fn(),
  sendTeamDeletionNotifications: vi.fn(),
}));

// ── Import under test (after mocks) ──────────────────────────────────────────

import { setActiveTeam } from "@/app/actions/team";

// ── Shared setup ──────────────────────────────────────────────────────────────

function setupMembership() {
  // profile_managers — no managed profiles for simplicity
  mocks.tableData.profile_managers = [];
  // team_members — caller is on the target team
  mocks.tableData.team_members = [{ profile_id: mocks.USER_ID, role: "coach" }];
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mocks.tableData).forEach((k) => delete mocks.tableData[k]);
  mocks.setHost("lista.team");
  setupMembership();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("setActiveTeam — subdomain routing disabled", () => {
  it("returns no redirectUrl when SUBDOMAIN_ROUTING_ENABLED=false, even for a club team", async () => {
    vi.stubEnv("SUBDOMAIN_ROUTING_ENABLED", "false");
    mocks.setHost("lista.team");
    mocks.tableData.teams = { organization_id: mocks.ORG_ID };
    mocks.tableData.organizations = {
      plan: "club_small",
      subdomain_status: "active",
      subdomain: "riverside",
    };

    const result = await setActiveTeam(mocks.TEAM_ID);

    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty("redirectUrl");
    vi.unstubAllEnvs();
  });

  it("returns no redirectUrl when TENANT_OVERRIDE_HOSTNAME is set (UI-testing mode)", async () => {
    vi.stubEnv("TENANT_OVERRIDE_HOSTNAME", "riverside.lista.team");
    // Real host is localhost — the override var only simulates the subdomain for UI purposes
    mocks.setHost("localhost");
    mocks.tableData.teams = { organization_id: mocks.ORG_ID };
    mocks.tableData.organizations = {
      plan: "club_small",
      subdomain_status: "active",
      subdomain: "riverside",
    };

    const result = await setActiveTeam(mocks.TEAM_ID);

    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty("redirectUrl");
    vi.unstubAllEnvs();
  });
});

describe("setActiveTeam — redirect logic", () => {
  it("returns redirectUrl to subdomain when switching to a club team from main domain", async () => {
    mocks.setHost("lista.team");
    mocks.tableData.teams = { organization_id: mocks.ORG_ID };
    // club_large here (sibling tests cover club_small) — both tiers redirect.
    mocks.tableData.organizations = {
      plan: "club_large",
      subdomain_status: "active",
      subdomain: "riverside",
    };

    const result = await setActiveTeam(mocks.TEAM_ID);

    expect(result).toMatchObject({
      success: true,
      redirectUrl: "https://riverside.lista.team/dashboard",
    });
  });

  it("returns redirectUrl to main domain when switching to a free team from a subdomain", async () => {
    mocks.setHost("riverside.lista.team");
    mocks.tableData.teams = { organization_id: mocks.ORG_ID };
    mocks.tableData.organizations = {
      plan: "free",
      subdomain_status: null,
      subdomain: null,
    };

    const result = await setActiveTeam(mocks.TEAM_ID);

    expect(result).toMatchObject({
      success: true,
      redirectUrl: "https://lista.team/dashboard",
    });
  });

  it("returns redirectUrl to main domain when team has no organization", async () => {
    mocks.setHost("riverside.lista.team");
    mocks.tableData.teams = { organization_id: null };

    const result = await setActiveTeam(mocks.TEAM_ID);

    expect(result).toMatchObject({
      success: true,
      redirectUrl: "https://lista.team/dashboard",
    });
  });

  it("returns no redirectUrl when switching to a free team on the main domain", async () => {
    mocks.setHost("lista.team");
    mocks.tableData.teams = { organization_id: mocks.ORG_ID };
    mocks.tableData.organizations = {
      plan: "free",
      subdomain_status: null,
      subdomain: null,
    };

    const result = await setActiveTeam(mocks.TEAM_ID);

    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty("redirectUrl");
  });

  it("returns no redirectUrl when already on the correct subdomain (no redirect loop)", async () => {
    mocks.setHost("riverside.lista.team");
    mocks.tableData.teams = { organization_id: mocks.ORG_ID };
    mocks.tableData.organizations = {
      plan: "club_small",
      subdomain_status: "active",
      subdomain: "riverside",
    };

    const result = await setActiveTeam(mocks.TEAM_ID);

    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty("redirectUrl");
  });

  it("returns no redirectUrl when club org has no active subdomain", async () => {
    mocks.setHost("lista.team");
    mocks.tableData.teams = { organization_id: mocks.ORG_ID };
    mocks.tableData.organizations = {
      plan: "club_small",
      subdomain_status: "pending",
      subdomain: "riverside",
    };

    const result = await setActiveTeam(mocks.TEAM_ID);

    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty("redirectUrl");
  });
});
