/**
 * Unit tests for assertTeamAdmin() — the shared team-admin authorization helper.
 *
 * Tests the two-path logic:
 *   Path 1: explicit team_members row with an admin role
 *   Path 2: org-level owner/director (mirrors is_org_admin() RLS behaviour)
 *
 * All DB calls are mocked via a lightweight fake admin client so no network
 * or database is required.
 */

import { describe, it, expect } from "vitest";
import { assertTeamAdmin } from "@/lib/api-auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// ── Mock admin client factory ─────────────────────────────────────────────────
//
// Builds a Supabase-like client where each table's select result is pre-set.
// The chain is "sticky" — .eq()/.in() always return the same chain/result —
// which is sufficient for assertTeamAdmin's linear query pattern.

type TableResults = {
  profiles?: { id: string } | null;
  team_members?: { role: string } | null;
  teams?: { organization_id: string } | null;
  organization_members?: { role: string } | null;
};

function makeAdmin(tables: TableResults): SupabaseClient<Database> {
  return {
    from: (table: string) => {
      const result = tables[table as keyof TableResults] ?? null;

      // Thenable chain so both `.maybeSingle()` and bare `await chain` work.
      const makeChain = (val: unknown): Record<string, unknown> => {
        const promise = Promise.resolve({ data: val, error: null });
        const chain: Record<string, unknown> = {
          eq: () => makeChain(val),
          in: () => makeChain(val),
          maybeSingle: () => promise,
          single: () => promise,
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            promise.then(res, rej),
        };
        return chain;
      };

      return { select: () => makeChain(result) } as unknown as ReturnType<
        SupabaseClient<Database>["from"]
      >;
    },
  } as unknown as SupabaseClient<Database>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AUTH_USER_ID = "auth-user-uuid";
const PROFILE_ID = "profile-uuid";
const TEAM_ID = "team-uuid";
const ORG_ID = "org-uuid";

const PROFILE = { id: PROFILE_ID };
const TEAM = { organization_id: ORG_ID };

// ── Profile not found ─────────────────────────────────────────────────────────

describe("assertTeamAdmin — profile not found", () => {
  it("returns false when the auth user has no profiles row", async () => {
    const admin = makeAdmin({ profiles: null });
    const result = await assertTeamAdmin(admin, AUTH_USER_ID, TEAM_ID);
    expect(result).toBe(false);
  });
});

// ── Path 1: explicit team_members row ─────────────────────────────────────────

describe("assertTeamAdmin — explicit team_members row (path 1)", () => {
  it("returns true for role 'coach'", async () => {
    const admin = makeAdmin({
      profiles: PROFILE,
      team_members: { role: "coach" },
    });
    expect(await assertTeamAdmin(admin, AUTH_USER_ID, TEAM_ID)).toBe(true);
  });

  it("returns true for role 'manager'", async () => {
    const admin = makeAdmin({
      profiles: PROFILE,
      team_members: { role: "manager" },
    });
    expect(await assertTeamAdmin(admin, AUTH_USER_ID, TEAM_ID)).toBe(true);
  });

  it("returns true for role 'director'", async () => {
    const admin = makeAdmin({
      profiles: PROFILE,
      team_members: { role: "director" },
    });
    expect(await assertTeamAdmin(admin, AUTH_USER_ID, TEAM_ID)).toBe(true);
  });

  it("returns false for role 'player'", async () => {
    const admin = makeAdmin({
      profiles: PROFILE,
      team_members: { role: "player" },
      // teams/org provided so the fallback also runs; still should be false
      teams: TEAM,
      organization_members: null,
    });
    expect(await assertTeamAdmin(admin, AUTH_USER_ID, TEAM_ID)).toBe(false);
  });

  it("returns false for role 'parent'", async () => {
    const admin = makeAdmin({
      profiles: PROFILE,
      team_members: { role: "parent" },
      teams: TEAM,
      organization_members: null,
    });
    expect(await assertTeamAdmin(admin, AUTH_USER_ID, TEAM_ID)).toBe(false);
  });
});

// ── Path 2: org-level fallback (no team_members row) ─────────────────────────

describe("assertTeamAdmin — org-level fallback (path 2)", () => {
  it("returns true when caller is an org owner with no team_members row", async () => {
    const admin = makeAdmin({
      profiles: PROFILE,
      team_members: null,
      teams: TEAM,
      organization_members: { role: "owner" },
    });
    expect(await assertTeamAdmin(admin, AUTH_USER_ID, TEAM_ID)).toBe(true);
  });

  it("returns true when caller is an org director with no team_members row", async () => {
    const admin = makeAdmin({
      profiles: PROFILE,
      team_members: null,
      teams: TEAM,
      organization_members: { role: "director" },
    });
    expect(await assertTeamAdmin(admin, AUTH_USER_ID, TEAM_ID)).toBe(true);
  });

  it("returns false when caller has no team_members row and no org membership", async () => {
    const admin = makeAdmin({
      profiles: PROFILE,
      team_members: null,
      teams: TEAM,
      organization_members: null,
    });
    expect(await assertTeamAdmin(admin, AUTH_USER_ID, TEAM_ID)).toBe(false);
  });

  it("returns false when the team has no organization_id", async () => {
    const admin = makeAdmin({
      profiles: PROFILE,
      team_members: null,
      teams: null, // team not found / no org
    });
    expect(await assertTeamAdmin(admin, AUTH_USER_ID, TEAM_ID)).toBe(false);
  });
});
