/**
 * Integration tests for GET /api/billing/status.
 *
 * The route answers with a club's commercial state — plan, trial dates, Stripe
 * customer and subscription ids — so it gates on an organization_members role
 * of owner or director, not on team membership. active_team_id is only used to
 * find which organization is being asked about, and is a stale pointer: the
 * route re-checks the role every time rather than trusting it.
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
  addOrgMember,
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
  it("returns plan and org for an organization owner", async () => {
    const { client, user } = await createTestUser();
    const { teamId, orgId } = await createTestTeam(user.id);
    trackIds({ teamId, orgId });

    // Team membership is not enough, and deliberately so: this route returns
    // the plan, the trial dates and the Stripe customer and subscription ids.
    // The fixture used to stop at the coach membership createTestTeam makes,
    // and the 403 it got was the route behaving correctly.
    await addOrgMember(orgId, user.id, "owner");
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

describe("GET /api/billing/status — organization role gate", () => {
  it("refuses a team member who holds no organization role", async () => {
    const { client, user } = await createTestUser();
    const { teamId, orgId } = await createTestTeam(user.id);
    trackIds({ teamId, orgId });

    // A coach on the team, and nothing more. createTestTeam makes exactly that.
    await setActiveTeam(user.id, teamId);

    const response = await statusRequest(await getAccessToken(client));

    expect(response.status).toBe(403);
  });

  /**
   * This case used to be called "removed from the team but active_team_id is
   * stale", and it passed for a reason its name did not mention: the user had
   * no organization role either, so the team removal decided nothing. The route
   * no longer looks at team membership at all — `active_team_id` only says
   * *which* organization is being asked about, and the role decides the answer.
   *
   * Which is right: an owner does not stop owning the club by leaving a team.
   * Pinned here so the next reader does not have to rediscover it, and so the
   * 403 above has to earn its result.
   */
  it("still answers for an owner who is no longer on the team", async () => {
    const { client, user } = await createTestUser();
    const { teamId, orgId } = await createTestTeam(user.id);
    trackIds({ teamId, orgId });

    await addOrgMember(orgId, user.id, "owner");
    await setActiveTeam(user.id, teamId);

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

    expect(response.status).toBe(200);
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
