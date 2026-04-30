/**
 * E2E tests for GET/DELETE /api/account/delete
 * Covers test plan sections 1 and 2 (account-deletion.md).
 *
 * This spec is self-contained: it creates and tears down its own Supabase
 * fixtures rather than sharing with the global middleware setup. This is
 * necessary because test 2.5 actually hard-deletes an auth user.
 *
 * Tests 1.3 and 2.3 (expired token) and 2.6 (deleteUser error) are not
 * covered here — they require token manipulation or server-side mocking
 * that is impractical in a Playwright integration test.
 */

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// ---------------------------------------------------------------------------
// Shared fixture state
// ---------------------------------------------------------------------------

let admin: SupabaseClient<Database>;
let anon: SupabaseClient<Database>;

const password = "TestPass1234!";
const ts = Date.now();

// Users created in beforeAll
let userEligibleId: string;       // owns no teams
let userEligibleToken: string;
let userOwnsOneId: string;        // owns exactly one team
let userOwnsOneToken: string;
let userOwnsTwoId: string;        // owns exactly two teams
let userOwnsTwoToken: string;

// Supabase resources
let orgId: string;
let sharedTeamId: string;         // owned by userOwnsOne; used for memberships in cascade test
let team2Id: string;              // owned by userOwnsTwo
let team3Id: string;              // owned by userOwnsTwo (for multi-team test)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signIn(email: string): Promise<string> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Sign-in failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const emailEligible = `del-eligible-${ts}@lista-test.example`;
  const emailOwnsOne  = `del-ownsone-${ts}@lista-test.example`;
  const emailOwnsTwo  = `del-ownstwo-${ts}@lista-test.example`;

  // Create users
  const { data: dA, error: eA } = await admin.auth.admin.createUser({ email: emailEligible, password, email_confirm: true });
  if (eA || !dA.user) throw new Error(`Create userEligible: ${eA?.message}`);
  userEligibleId = dA.user.id;

  const { data: dB, error: eB } = await admin.auth.admin.createUser({ email: emailOwnsOne, password, email_confirm: true });
  if (eB || !dB.user) throw new Error(`Create userOwnsOne: ${eB?.message}`);
  userOwnsOneId = dB.user.id;

  const { data: dC, error: eC } = await admin.auth.admin.createUser({ email: emailOwnsTwo, password, email_confirm: true });
  if (eC || !dC.user) throw new Error(`Create userOwnsTwo: ${eC?.message}`);
  userOwnsTwoId = dC.user.id;

  // Create org
  orgId = crypto.randomUUID();
  await admin.from("organizations").insert({ id: orgId, name: `AccDel Org ${ts}`, slug: `accdel-org-${ts}` });

  // Create teams
  sharedTeamId = crypto.randomUUID();
  team2Id = crypto.randomUUID();
  team3Id = crypto.randomUUID();
  await admin.from("teams").insert([
    { id: sharedTeamId, name: `AccDel SharedTeam ${ts}`, organization_id: orgId, owner_id: userOwnsOneId },
    { id: team2Id,      name: `AccDel Team2 ${ts}`,      organization_id: orgId, owner_id: userOwnsTwoId },
    { id: team3Id,      name: `AccDel Team3 ${ts}`,      organization_id: orgId, owner_id: userOwnsTwoId },
  ]);

  // Sign in all three fixture users
  userEligibleToken = await signIn(emailEligible);
  userOwnsOneToken  = await signIn(emailOwnsOne);
  userOwnsTwoToken  = await signIn(emailOwnsTwo);
});

test.afterAll(async () => {
  // Best-effort cleanup (some rows may already be gone via cascade)
  try { await admin.auth.admin.deleteUser(userEligibleId); } catch {}
  try { await admin.auth.admin.deleteUser(userOwnsOneId); } catch {}
  try { await admin.auth.admin.deleteUser(userOwnsTwoId); } catch {}
  await admin.from("teams").delete().in("id", [sharedTeamId, team2Id, team3Id]);
  await admin.from("organizations").delete().eq("id", orgId);
});

// ---------------------------------------------------------------------------
// Section 1 — GET /api/account/delete (eligibility check)
// ---------------------------------------------------------------------------

test("1.1 — GET without Authorization header returns 401", async ({ request }) => {
  const res = await request.get("/api/account/delete");
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ error: "unauthorized" });
});

test("1.2 — GET with malformed token returns 401", async ({ request }) => {
  const res = await request.get("/api/account/delete", {
    headers: { Authorization: "Bearer not-a-jwt" },
  });
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ error: "unauthorized" });
});

test("1.4 — GET with valid token and no owned teams returns 200 eligible", async ({ request }) => {
  const res = await request.get("/api/account/delete", {
    headers: { Authorization: `Bearer ${userEligibleToken}` },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ eligible: true });
});

test("1.5 — GET with valid token and one owned team returns 409 owns_teams with team name", async ({ request }) => {
  const res = await request.get("/api/account/delete", {
    headers: { Authorization: `Bearer ${userOwnsOneToken}` },
  });
  expect(res.status()).toBe(409);
  const body = await res.json();
  expect(body).toMatchObject({ error: "owns_teams" });
  expect(body.teams).toHaveLength(1);
  expect(body.teams[0]).toContain(`AccDel SharedTeam ${ts}`);
});

test("1.6 — GET with valid token and multiple owned teams returns 409 owns_teams with all names", async ({ request }) => {
  const res = await request.get("/api/account/delete", {
    headers: { Authorization: `Bearer ${userOwnsTwoToken}` },
  });
  expect(res.status()).toBe(409);
  const body = await res.json();
  expect(body).toMatchObject({ error: "owns_teams" });
  expect(body.teams).toHaveLength(2);
  expect(body.teams).toEqual(
    expect.arrayContaining([
      expect.stringContaining(`AccDel Team2 ${ts}`),
      expect.stringContaining(`AccDel Team3 ${ts}`),
    ])
  );
});

// ---------------------------------------------------------------------------
// Section 2 — DELETE /api/account/delete (perform deletion)
// ---------------------------------------------------------------------------

test("2.1 — DELETE without Authorization header returns 401", async ({ request }) => {
  const res = await request.delete("/api/account/delete");
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ error: "unauthorized" });
});

test("2.2 — DELETE with malformed token returns 401", async ({ request }) => {
  const res = await request.delete("/api/account/delete", {
    headers: { Authorization: "Bearer not-a-jwt" },
  });
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ error: "unauthorized" });
});

test("2.4 — DELETE race guard: user who owns a team gets 409, not deleted", async ({ request }) => {
  const res = await request.delete("/api/account/delete", {
    headers: { Authorization: `Bearer ${userOwnsOneToken}` },
  });
  expect(res.status()).toBe(409);
  const body = await res.json();
  expect(body).toMatchObject({ error: "owns_teams" });

  // Verify user still exists
  const { data: user } = await admin.auth.admin.getUserById(userOwnsOneId);
  expect(user.user).not.toBeNull();
});

test("2.5 — DELETE eligible user returns 200 and cascade-deletes all personal data", async ({ request }) => {
  // Create a disposable user specifically for this destructive test
  const email = `del-cascade-${ts}@lista-test.example`;
  const { data: d, error: e } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (e || !d.user) throw new Error(`Create cascade user: ${e?.message}`);
  const userId = d.user.id;

  // For auth-backed users, profiles.id == auth.users.id (see migrations)
  const profileId = userId;

  // Insert supporting records that should be cascade-deleted
  await admin.from("team_members").insert({ profile_id: profileId, team_id: sharedTeamId, role: "player" });
  await admin.from("notification_preferences").insert({ profile_id: profileId });
  await admin.from("push_subscriptions").insert({ profile_id: profileId, expo_push_token: `ExpoToken[cascade-test-${ts}]` });

  // Create a managed player profile (auth_user_id = NULL) that must SURVIVE the deletion
  const managedProfileId = crypto.randomUUID();
  await admin.from("profiles").insert({
    id: managedProfileId,
    first_name: "Managed",
    last_name: "Player",
    email: `managed-cascade-${ts}@lista-test.example`,
    // auth_user_id intentionally omitted (NULL)
  });
  await admin.from("team_members").insert({
    profile_id: managedProfileId,
    team_id: sharedTeamId,
    role: "player",
  });

  // Sign in to get a fresh token
  const token = await signIn(email);

  // Confirm eligibility first
  const eligRes = await request.get("/api/account/delete", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(eligRes.status()).toBe(200);

  // Perform deletion
  const delRes = await request.delete("/api/account/delete", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(delRes.status()).toBe(200);
  expect(await delRes.json()).toMatchObject({ deleted: true });

  // --- Deletion cascade assertions ---

  // auth.users row is gone
  const { data: deletedUser } = await admin.auth.admin.getUserById(userId);
  expect(deletedUser.user).toBeNull();

  // profiles row is gone
  const { data: profileRows } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userId);
  expect(profileRows).toHaveLength(0);

  // team_members rows for the deleted profile are gone
  const { data: memberRows } = await admin
    .from("team_members")
    .select("id")
    .eq("profile_id", profileId);
  expect(memberRows).toHaveLength(0);

  // notification_preferences is gone
  const { data: notifRows } = await admin
    .from("notification_preferences")
    .select("id")
    .eq("profile_id", profileId);
  expect(notifRows).toHaveLength(0);

  // push_subscriptions is gone
  const { data: pushRows } = await admin
    .from("push_subscriptions")
    .select("id")
    .eq("profile_id", profileId);
  expect(pushRows).toHaveLength(0);

  // --- Managed player profile must survive ---

  // profiles row for the managed player still exists
  const { data: managedProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("id", managedProfileId)
    .single();
  expect(managedProfile).not.toBeNull();
  expect(managedProfile!.id).toBe(managedProfileId);

  // team_members row for the managed player still exists
  const { data: managedMemberRows } = await admin
    .from("team_members")
    .select("id")
    .eq("profile_id", managedProfileId);
  expect(managedMemberRows).toHaveLength(1);

  // Cleanup managed player fixtures (the auth user is already deleted)
  await admin.from("team_members").delete().eq("profile_id", managedProfileId);
  await admin.from("profiles").delete().eq("id", managedProfileId);
});

// ---------------------------------------------------------------------------
// Section 1 (middleware) — /api/account/ is in the public allowlist
// ---------------------------------------------------------------------------

test("middleware — unauthenticated GET /api/account/delete returns JSON, not a redirect", async ({ request }) => {
  const res = await request.get("/api/account/delete", { maxRedirects: 0 });
  // If the middleware were to redirect this, status would be 302/307 with a location header.
  // Instead the route itself should handle it and return 401.
  expect([302, 307]).not.toContain(res.status());
  const body = await res.json();
  expect(body).toHaveProperty("error", "unauthorized");
});

test("middleware — unauthenticated DELETE /api/account/delete returns JSON, not a redirect", async ({ request }) => {
  const res = await request.delete("/api/account/delete", { maxRedirects: 0 });
  expect([302, 307]).not.toContain(res.status());
  const body = await res.json();
  expect(body).toHaveProperty("error", "unauthorized");
});
