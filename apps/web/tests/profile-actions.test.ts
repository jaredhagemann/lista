/**
 * Unit tests for guardian-related server actions in app/actions/profile.ts.
 *
 * createManagedProfile writes through a service-role client, which bypasses RLS,
 * so every authorization decision has to happen in the action itself. Server
 * actions are callable directly from the browser — what the form sends is not a
 * protection.
 *   - BUG-001: it accepted a caller-supplied teamId and role and inserted a
 *     team_members row with them.
 *   - BUG-002: it accepted a caller-supplied managerId, so a caller could make
 *     someone else a child's guardian, and it silently linked any existing
 *     account whose email matched as a second guardian, without that person
 *     accepting (D1 requires acceptance).
 *
 * removeManagedProfile deletes the caller's own guardian link. The database
 * refuses to remove a player's last guardian when the player has no login; the
 * action must explain that rather than surface a raw database error.
 *
 * Supabase, cookies and cache revalidation are mocked — no network or DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];

  // Any lookup by email finds an existing account, so the old auto-link path
  // would fire if it still existed.
  const existingAccountLookup = () => {
    const found = Promise.resolve({ data: { auth_user_id: "existing-account" }, error: null });
    const chain: Record<string, unknown> = {
      eq: () => chain,
      neq: () => chain,
      maybeSingle: () => found,
    };
    return chain;
  };

  const adminFrom = vi.fn((table: string) => ({
    insert: vi.fn((values: Record<string, unknown>) => {
      inserts.push({ table, values });
      return Promise.resolve({ error: null });
    }),
    select: vi.fn(existingAccountLookup),
    delete: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
  }));

  const userDeleteResult = { current: { error: null as { message: string } | null } };
  const userFrom = vi.fn(() => ({
    delete: () => ({
      eq: () => ({ eq: () => Promise.resolve(userDeleteResult.current) }),
    }),
  }));

  return { inserts, adminFrom, userFrom, userDeleteResult, getUser: vi.fn() };
});

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser }, from: mocks.userFrom })),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: mocks.adminFrom })),
}));

import { createManagedProfile, removeManagedProfile } from "@/app/actions/profile";
import { LAST_GUARDIAN_MESSAGE } from "@/lib/guardians";

type Args = Parameters<typeof createManagedProfile>[0];

function tables() {
  return mocks.inserts.map((i) => i.table);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserts.length = 0;
  mocks.userDeleteResult.current = { error: null };
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

describe("createManagedProfile — team admission (BUG-001)", () => {
  it("never inserts a team_members row, even when a caller supplies teamId and role", async () => {
    const hostileArgs = {
      firstName: "Kid",
      teamId: "11111111-1111-1111-1111-111111111111",
      role: "coach",
    } as unknown as Args;

    await createManagedProfile(hostileArgs);

    expect(tables()).not.toContain("team_members");
  });
});

describe("createManagedProfile — guardian links (BUG-002)", () => {
  it("links the signed-in user as guardian, ignoring a caller-supplied managerId", async () => {
    const hostileArgs = { firstName: "Kid", managerId: "someone-else" } as unknown as Args;

    await createManagedProfile(hostileArgs);

    const links = mocks.inserts.filter((i) => i.table === "profile_managers");
    expect(links.map((l) => l.values.manager_id)).toEqual(["user-1"]);
  });

  it("does not auto-link an existing account whose email matches the new profile", async () => {
    await createManagedProfile({ firstName: "Kid", email: "someone@example.com" });

    const links = mocks.inserts.filter((i) => i.table === "profile_managers");
    expect(links.map((l) => l.values.manager_id)).toEqual(["user-1"]);
  });

  it("still creates the managed profile and links the signed-in user", async () => {
    const result = await createManagedProfile({ firstName: "Kid" });

    expect(result).toMatchObject({ success: true });
    expect(tables()).toEqual(["profiles", "profile_managers"]);
  });

  it("rejects a signed-out caller without writing anything", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const result = await createManagedProfile({ firstName: "Kid" });

    expect(result).toEqual({ error: "Unauthorized" });
    expect(mocks.inserts).toHaveLength(0);
  });
});

describe("removeManagedProfile — last guardian (BUG-002, D1)", () => {
  it("explains the refusal when the database protects the last guardian", async () => {
    mocks.userDeleteResult.current = {
      error: { message: "LAST_GUARDIAN: player child-1 must keep at least one guardian with a login" },
    };

    const result = await removeManagedProfile("child-1");

    expect(result).toEqual({ error: LAST_GUARDIAN_MESSAGE });
  });

  it("still succeeds when the database allows the removal", async () => {
    const result = await removeManagedProfile("child-1");

    expect(result).toEqual({ success: true });
  });
});
