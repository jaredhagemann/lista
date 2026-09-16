/**
 * Unit tests for the createManagedProfile server action (app/actions/profile.ts).
 *
 * Why this matters (BUG-001): the action writes through a service-role client,
 * which bypasses RLS. It used to accept a caller-supplied teamId and role and
 * insert a team_members row with them, so any signed-in user could add a
 * profile they manage to any team, at any role, regardless of the team_members
 * INSERT policy. Server actions are callable directly from the browser, so the
 * form never passing those fields was not a protection.
 *
 * Supabase, cookies and cache revalidation are mocked — no network or DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const from = vi.fn((table: string) => ({
    insert: vi.fn((values: Record<string, unknown>) => {
      inserts.push({ table, values });
      return Promise.resolve({ error: null });
    }),
    delete: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
  }));
  return {
    inserts,
    from,
    getUser: vi.fn(),
  };
});

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: mocks.from })),
}));

import { createManagedProfile } from "@/app/actions/profile";

type Args = Parameters<typeof createManagedProfile>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserts.length = 0;
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

describe("createManagedProfile — team admission (BUG-001)", () => {
  it("never inserts a team_members row, even when a caller supplies teamId and role", async () => {
    const hostileArgs = {
      firstName: "Kid",
      managerId: "user-1",
      teamId: "11111111-1111-1111-1111-111111111111",
      role: "coach",
    } as unknown as Args;

    await createManagedProfile(hostileArgs);

    expect(mocks.inserts.map((i) => i.table)).not.toContain("team_members");
  });

  it("still creates the managed profile and links the manager", async () => {
    const result = await createManagedProfile({ firstName: "Kid", managerId: "user-1" });

    expect(result).toMatchObject({ success: true });
    expect(mocks.inserts.map((i) => i.table)).toEqual(["profiles", "profile_managers"]);
  });

  it("rejects a signed-out caller without writing anything", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const result = await createManagedProfile({ firstName: "Kid", managerId: "user-1" });

    expect(result).toEqual({ error: "Unauthorized" });
    expect(mocks.inserts).toHaveLength(0);
  });
});
