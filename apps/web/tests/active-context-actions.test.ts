/**
 * Saving the device's context (docs/specs/device-local-active-context.md).
 *
 *   - a switch saves the tuple on this device only, and still records the team
 *     as the "last picked" default for devices without a context (D1, D2)
 *   - the dashboard's seed or repair is saved only if the server itself would
 *     choose it for this account (D2, D3, D6)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const ME = "00000000-0000-4000-8000-000000000001";
const CHILD = "00000000-0000-4000-8000-000000000002";
const TEAM = "10000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  const cookieSets: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, error: null });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "order", "limit"]) chain[m] = () => chain;
    chain.update = (values: Record<string, unknown>) => {
      updates.push({ table, values });
      return chain;
    };
    chain.single = result;
    chain.maybeSingle = result;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
    return chain;
  };
  return {
    tables,
    updates,
    cookieSets,
    load: vi.fn(),
    client: { auth: { getUser: vi.fn() }, from },
  };
});

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve({ get: () => "lista.team" }),
  cookies: () =>
    Promise.resolve({
      get: () => undefined,
      set: (name: string, value: string, options: Record<string, unknown>) =>
        mocks.cookieSets.push({ name, value, options }),
      delete: vi.fn(),
    }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => mocks.client }));
vi.mock("@/lib/active-context", () => ({ loadActiveContext: mocks.load }));
vi.mock("@/lib/notifications/team-deletion", () => ({
  collectTeamDeletionRecipients: vi.fn(),
  sendTeamDeletionNotifications: vi.fn(),
}));

import { saveActiveContext } from "@/app/actions/context";
import { setActiveTeam } from "@/app/actions/team";
import { setActiveProfile } from "@/app/actions/profile";

const contextCookie = () => mocks.cookieSets.filter((c) => c.name === "lista_context");

beforeEach(() => {
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key];
  mocks.updates.length = 0;
  mocks.cookieSets.length = 0;
  mocks.load.mockReset();
  mocks.client.auth.getUser.mockResolvedValue({ data: { user: { id: ME } } });
  vi.stubEnv("SUBDOMAIN_ROUTING_ENABLED", "false");
});

describe("saveActiveContext: the dashboard's seed or repair", () => {
  it("saves the context the server chose", async () => {
    mocks.load.mockResolvedValue({ save: { accountId: ME, profileId: CHILD, teamId: TEAM } });

    expect(await saveActiveContext(CHILD, TEAM)).toEqual({ saved: true });
    expect(contextCookie()).toEqual([
      expect.objectContaining({ value: `v1.${ME}.${CHILD}.${TEAM}`, options: expect.objectContaining({ httpOnly: true }) }),
    ]);
  });

  it("refuses a context the server didn't choose: a caller can't pick whom it acts as", async () => {
    mocks.load.mockResolvedValue({ save: { accountId: ME, profileId: ME, teamId: TEAM } });

    expect(await saveActiveContext(CHILD, TEAM)).toEqual({ saved: false });
    expect(contextCookie()).toEqual([]);
  });

  it("saves nothing when nothing needs saving, or a read failed", async () => {
    mocks.load.mockResolvedValue({ save: null });

    expect(await saveActiveContext(CHILD, TEAM)).toEqual({ saved: false });
    expect(contextCookie()).toEqual([]);
  });

  it("saves nothing signed out", async () => {
    mocks.client.auth.getUser.mockResolvedValue({ data: { user: null } });

    expect(await saveActiveContext(CHILD, TEAM)).toEqual({ saved: false });
    expect(mocks.load).not.toHaveBeenCalled();
  });
});

describe("setActiveTeam: a switch on this device", () => {
  it("saves the tuple here, and records the team as the last-picked default", async () => {
    mocks.tables.profile_managers = [{ managed_id: CHILD }];
    mocks.tables.team_members = [{ profile_id: CHILD, role: "player" }];

    expect(await setActiveTeam(TEAM)).toEqual({ success: true });

    expect(contextCookie().map((c) => c.value)).toEqual([`v1.${ME}.${CHILD}.${TEAM}`]);
    expect(mocks.updates).toEqual([{ table: "profiles", values: { active_team_id: TEAM } }]);
  });

  it("prefers the account's own profile on the team", async () => {
    mocks.tables.profile_managers = [{ managed_id: CHILD }];
    mocks.tables.team_members = [
      { profile_id: CHILD, role: "player" },
      { profile_id: ME, role: "coach" },
    ];

    await setActiveTeam(TEAM);

    expect(contextCookie().map((c) => c.value)).toEqual([`v1.${ME}.${ME}.${TEAM}`]);
  });

  it("a team none of the account's people are on saves nothing", async () => {
    mocks.tables.profile_managers = [];
    mocks.tables.team_members = [];

    expect(await setActiveTeam(TEAM)).toEqual({ error: "Not a member of this team" });
    expect(contextCookie()).toEqual([]);
  });
});

describe("setActiveProfile: viewing as someone else on this device", () => {
  it("saves the tuple here, and records the team as the last-picked default", async () => {
    mocks.tables.profile_managers = { id: "link-1" };
    mocks.tables.team_members = { id: "tm-1" };

    expect(await setActiveProfile(CHILD, TEAM)).toEqual({ success: true });

    expect(contextCookie().map((c) => c.value)).toEqual([`v1.${ME}.${CHILD}.${TEAM}`]);
    expect(mocks.updates).toEqual([{ table: "profiles", values: { active_team_id: TEAM } }]);
  });

  it("a profile the account doesn't manage is refused, and nothing is saved", async () => {
    mocks.tables.profile_managers = null;

    expect(await setActiveProfile(CHILD, TEAM)).toEqual({ error: "Not authorized to view as this profile" });
    expect(contextCookie()).toEqual([]);
    expect(mocks.updates).toEqual([]);
  });
});
