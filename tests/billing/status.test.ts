/**
 * Integration tests for GET /api/billing/status.
 *
 * These tests exercise the application-layer membership guard added in Sprint 2:
 * active_team_id is a stale pointer on the profile — the route must verify
 * current team_members membership before returning org billing data.
 *
 * Requires the local Supabase stack: `supabase start`
 * Run with: pnpm test:rls  (resets the DB first; picks up tests/billing too)
 *
 * The cookie-based auth path in resolveRequestUser() calls createClient() from
 * @/lib/supabase/server, which calls Next.js's cookies() and requires a live
 * request scope. We mock createClient() to return a no-session Supabase client
 * so that path gracefully returns null and the route falls through to Bearer
 * token auth (the mobile/API path), which works in tests.
 */

import { vi, describe, it, expect, afterAll } from "vitest";

// Must be declared before any imports that transitively load the module.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  }),
}));

import { GET } from "@/app/api/billing/status/route";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  cleanupTestData,
  trackIds,
} from "../rls/helpers";

afterAll(async () => {
  await cleanupTestData();
});

async function statusRequest(accessToken: string): Promise<Response> {
  return GET(
    new Request("http://localhost/api/billing/status", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  );
}

async function getAccessToken(client: Awaited<ReturnType<typeof createTestUser>>["client"]) {
  const { data: { session } } = await client.auth.getSession();
  return session!.access_token;
}

async function setActiveTeam(authUserId: string, teamId: string) {
  await adminClient
    .from("profiles")
    .update({ active_team_id: teamId })
    .eq("auth_user_id", authUserId);
}

// ── Happy path ────────────────────────────────────────────────────────────────

describe("GET /api/billing/status — happy path", () => {
  it("returns plan and org for an active team member", async () => {
    const { client, user } = await createTestUser();
    const { teamId, orgId } = await createTestTeam(user.id);
    trackIds({ teamId, orgId });

    await setActiveTeam(user.id, teamId);

    const response = await statusRequest(await getAccessToken(client));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.orgId).toBe(orgId);
    expect(body.plan).toBe("free");
    expect(body.subscriptionStatus).toBeNull();
    expect(body.hasStripeCustomer).toBe(false);
  });
});

// ── Membership gate ───────────────────────────────────────────────────────────

describe("GET /api/billing/status — membership gate", () => {
  it("returns 403 when user has been removed from the team but active_team_id is stale", async () => {
    const { client, user } = await createTestUser();
    const { teamId, orgId } = await createTestTeam(user.id);
    trackIds({ teamId, orgId });

    await setActiveTeam(user.id, teamId);

    // Simulate being removed from the team — active_team_id is NOT cleared
    const { data: profile } = await adminClient
      .from("profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();
    await adminClient
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("profile_id", profile!.id);

    const response = await statusRequest(await getAccessToken(client));

    expect(response.status).toBe(403);
  });

  it("returns 401 for an unauthenticated request", async () => {
    const response = await GET(new Request("http://localhost/api/billing/status"));
    expect(response.status).toBe(401);
  });

  it("returns 404 when profile has no active_team_id", async () => {
    const { client } = await createTestUser();
    // active_team_id is null by default for a fresh user

    const response = await statusRequest(await getAccessToken(client));
    expect(response.status).toBe(404);
  });
});
