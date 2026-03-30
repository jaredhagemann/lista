import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import type { Database } from "@/types/database";

const FIXTURES_FILE = path.join(__dirname, ".fixtures.json");

let tokenA: string;
let tokenB: string;
let inviteId: string;
let userAId: string;
let userBId: string;
let teamId: string;
let managedProfileId: string;
let managerInviteId: string;
let admin: SupabaseClient<Database>;

test.beforeAll(async () => {
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf-8")) as {
    emailA: string;
    emailB: string;
    password: string;
    inviteId: string;
    userAId: string;
    userBId: string;
    teamId: string;
    managedProfileId: string;
    managerInviteId: string;
  };
  inviteId = fixtures.inviteId;
  userAId = fixtures.userAId;
  userBId = fixtures.userBId;
  teamId = fixtures.teamId;
  managedProfileId = fixtures.managedProfileId;
  managerInviteId = fixtures.managerInviteId;

  admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: sessionA, error: errA } = await anon.auth.signInWithPassword({
    email: fixtures.emailA,
    password: fixtures.password,
  });
  if (errA || !sessionA.session) throw new Error(`Sign-in user A failed: ${errA?.message}`);
  tokenA = sessionA.session.access_token;

  const { data: sessionB, error: errB } = await anon.auth.signInWithPassword({
    email: fixtures.emailB,
    password: fixtures.password,
  });
  if (errB || !sessionB.session) throw new Error(`Sign-in user B failed: ${errB?.message}`);
  tokenB = sessionB.session.access_token;
});

// Bug 2 regression: middleware was redirecting /api/invite/* to /login
test("GET /api/invite/:id without auth returns JSON, not a redirect", async ({ request }) => {
  const response = await request.get(`/api/invite/${inviteId}`);
  expect(response.status()).not.toBe(302);
  expect(response.status()).not.toBe(307);
  const body = await response.json();
  expect(body).toHaveProperty("id");
});

// Bug 1 regression: mismatched email must be rejected before any DB writes
test("POST /api/invite/:id/accept type=self with mismatched email returns 403 and leaves DB untouched", async ({ request }) => {
  const response = await request.post(`/api/invite/${inviteId}/accept`, {
    headers: { Authorization: `Bearer ${tokenB}` },
    data: { type: "self" },
  });
  expect(response.status()).toBe(403);
  const body = await response.json();
  expect(body).toHaveProperty("error", "Forbidden");

  // Verify the invitation was not accepted
  const { data: invite } = await admin
    .from("invitations")
    .select("accepted_at")
    .eq("id", inviteId)
    .single();
  expect(invite?.accepted_at).toBeNull();

  // Verify no team_members row was created for user B
  const { data: membership } = await admin
    .from("team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("profile_id", userBId);
  expect(membership).toHaveLength(0);
});

// Bug 1 + Bug 2: matching email goes through and writes the correct DB rows
test("POST /api/invite/:id/accept type=self with matching email returns success and writes DB", async ({ request }) => {
  const response = await request.post(`/api/invite/${inviteId}/accept`, {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: { type: "self" },
  });
  expect(response.status()).not.toBe(302);
  expect(response.status()).not.toBe(307);
  const body = await response.json();
  expect(body).toHaveProperty("success", true);

  // Verify the team_members row was created for user A
  const { data: membership } = await admin
    .from("team_members")
    .select("id, role")
    .eq("team_id", teamId)
    .eq("profile_id", userAId);
  expect(membership).toHaveLength(1);
  expect(membership![0].role).toBe("player");

  // Verify the invitation was marked accepted
  const { data: invite } = await admin
    .from("invitations")
    .select("accepted_at")
    .eq("id", inviteId)
    .single();
  expect(invite?.accepted_at).not.toBeNull();
});

// Gap 1: email guard must fire on the manager invite path, not just the self path
test("POST /api/invite/:id/accept type=manager with mismatched email returns 403 and leaves DB untouched", async ({ request }) => {
  const response = await request.post(`/api/invite/${managerInviteId}/accept`, {
    headers: { Authorization: `Bearer ${tokenB}` },
    data: { type: "manager" },
  });
  expect(response.status()).toBe(403);
  const body = await response.json();
  expect(body).toHaveProperty("error", "Forbidden");

  // Verify the invitation was not accepted
  const { data: invite } = await admin
    .from("invitations")
    .select("accepted_at")
    .eq("id", managerInviteId)
    .single();
  expect(invite?.accepted_at).toBeNull();

  // Verify no profile_managers row was created for user B
  const { data: links } = await admin
    .from("profile_managers")
    .select("id")
    .eq("managed_id", managedProfileId)
    .eq("manager_id", userBId);
  expect(links).toHaveLength(0);
});

// Gap 1: matching email on manager path writes the correct DB rows
test("POST /api/invite/:id/accept type=manager with matching email returns success and writes DB", async ({ request }) => {
  const response = await request.post(`/api/invite/${managerInviteId}/accept`, {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: { type: "manager" },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toHaveProperty("success", true);

  // Verify the profile_managers link was created for user A → managed profile
  const { data: links } = await admin
    .from("profile_managers")
    .select("id, relationship")
    .eq("managed_id", managedProfileId)
    .eq("manager_id", userAId);
  expect(links).toHaveLength(1);
  expect(links![0].relationship).toBe("parent");

  // Verify the invitation was marked accepted
  const { data: invite } = await admin
    .from("invitations")
    .select("accepted_at")
    .eq("id", managerInviteId)
    .single();
  expect(invite?.accepted_at).not.toBeNull();

  // Verify no team_members row was created — manager acceptance must not mix in self-invite side effects
  const { data: membership } = await admin
    .from("team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("profile_id", userAId);
  expect(membership).toHaveLength(1); // only the row from the earlier type=self test
});

// Item 1: duplicate acceptance — self invite
test("POST /api/invite/:id/accept type=self a second time returns 410 and does not mutate DB", async ({ request }) => {
  // Capture pre-retry state
  const { data: beforeInvite } = await admin
    .from("invitations")
    .select("accepted_at")
    .eq("id", inviteId)
    .single();
  const { data: beforeMembership } = await admin
    .from("team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("profile_id", userAId);

  const response = await request.post(`/api/invite/${inviteId}/accept`, {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: { type: "self" },
  });
  expect(response.status()).toBe(410);
  const body = await response.json();
  expect(body).toHaveProperty("error", "Invitation already accepted");

  // accepted_at must not have been rewritten
  const { data: afterInvite } = await admin
    .from("invitations")
    .select("accepted_at")
    .eq("id", inviteId)
    .single();
  expect(afterInvite?.accepted_at).toBe(beforeInvite?.accepted_at);

  // team_members count must not have increased
  const { data: afterMembership } = await admin
    .from("team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("profile_id", userAId);
  expect(afterMembership).toHaveLength(beforeMembership!.length);
});

// Item 1: duplicate acceptance — manager invite
test("POST /api/invite/:id/accept type=manager a second time returns 410 and does not mutate DB", async ({ request }) => {
  // Capture pre-retry state
  const { data: beforeInvite } = await admin
    .from("invitations")
    .select("accepted_at")
    .eq("id", managerInviteId)
    .single();
  const { data: beforeLinks } = await admin
    .from("profile_managers")
    .select("id")
    .eq("managed_id", managedProfileId)
    .eq("manager_id", userAId);

  const response = await request.post(`/api/invite/${managerInviteId}/accept`, {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: { type: "manager" },
  });
  expect(response.status()).toBe(410);
  const body = await response.json();
  expect(body).toHaveProperty("error", "Invitation already accepted");

  // accepted_at must not have been rewritten
  const { data: afterInvite } = await admin
    .from("invitations")
    .select("accepted_at")
    .eq("id", managerInviteId)
    .single();
  expect(afterInvite?.accepted_at).toBe(beforeInvite?.accepted_at);

  // profile_managers count must not have increased
  const { data: afterLinks } = await admin
    .from("profile_managers")
    .select("id")
    .eq("managed_id", managedProfileId)
    .eq("manager_id", userAId);
  expect(afterLinks).toHaveLength(beforeLinks!.length);
});

// Item 5: invite lookup edge cases
test("GET /api/invite/:id with a non-existent ID returns 404 JSON, not a redirect", async ({ request }) => {
  const response = await request.get(`/api/invite/${crypto.randomUUID()}`);
  expect(response.status()).toBe(404);
  expect(response.status()).not.toBe(307);
  const body = await response.json();
  expect(body).toHaveProperty("error");
});

test("GET /api/invite/:id for an already-accepted invite returns 410 JSON, not a redirect", async ({ request }) => {
  const response = await request.get(`/api/invite/${inviteId}`);
  expect(response.status()).toBe(410);
  expect(response.status()).not.toBe(307);
  const body = await response.json();
  expect(body).toHaveProperty("error");
});

test("POST /api/invite/:id/accept for a non-existent ID returns 404", async ({ request }) => {
  const response = await request.post(`/api/invite/${crypto.randomUUID()}/accept`, {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: { type: "self" },
  });
  expect(response.status()).toBe(404);
  const body = await response.json();
  expect(body).toHaveProperty("error");
});

// Gap 3: missing Authorization header returns 401, not a redirect or unhandled error
test("POST /api/invite/:id/accept with no Authorization header returns 401", async ({ request }) => {
  const response = await request.post(`/api/invite/${inviteId}/accept`, {
    data: { type: "self" },
  });
  expect(response.status()).toBe(401);
  const body = await response.json();
  expect(body).toHaveProperty("error", "Unauthorized");
});

// Bug 2 regression: middleware was redirecting /api/managed-profiles to /login
test("POST /api/managed-profiles without auth returns 401, not a redirect", async ({ request }) => {
  const response = await request.post("/api/managed-profiles", {
    data: { firstName: "Test" },
  });
  expect(response.status()).toBe(401);
});

// Item 4: protected API boundary — proves the public-route allowlist has not been over-broadened
test("logged-out POST /api/notifications/send is redirected to /login by middleware", async ({ request }) => {
  // maxRedirects: 0 returns the raw redirect response instead of following it,
  // letting us assert the middleware 307 and location header directly.
  const response = await request.post("/api/notifications/send", {
    maxRedirects: 0,
    data: {},
  });
  expect([302, 307]).toContain(response.status());
  expect(response.headers()["location"]).toContain("/login");
});

// Bug 3 regression: middleware was intercepting /manifest.json for logged-out users
test("GET /manifest.json returns 200 for logged-out users", async ({ request }) => {
  const response = await request.get("/manifest.json");
  expect(response.status()).toBe(200);
});

// Bug 3 regression: middleware was intercepting /sw.js for logged-out users
test("GET /sw.js returns 200 for logged-out users", async ({ request }) => {
  const response = await request.get("/sw.js");
  expect(response.status()).toBe(200);
});
