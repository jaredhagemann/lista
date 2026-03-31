import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL.includes("127.0.0.1") && !SUPABASE_URL.includes("localhost")) {
  throw new Error("E2E tests must run against a local Supabase instance. Check NEXT_PUBLIC_SUPABASE_URL in .env.test.local");
}

const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const TEST_COACH_EMAIL = "e2e-coach@lista.test";
export const TEST_MANAGER_EMAIL = "e2e-manager@lista.test";
export const TEST_PLAYER_EMAIL = "e2e-player@lista.test";
export const TEST_INVITEE_EMAIL = "e2e-invitee@lista.test";
export const TEST_PASSWORD = "Test1234!";
export const TEST_TEAM_NAME = "E2E Test Team";

async function globalSetup() {
  // Clean up any leftover state from a previous run
  await cleanupTestData();

  // Create users (skip email confirmation via service role)
  const coach = await createUser(TEST_COACH_EMAIL);
  const manager = await createUser(TEST_MANAGER_EMAIL);
  const player = await createUser(TEST_PLAYER_EMAIL);
  await createUser(TEST_INVITEE_EMAIL);

  // Create organization + team
  const orgId = crypto.randomUUID();
  const teamId = crypto.randomUUID();

  const { error: orgError } = await admin.from("organizations").insert({
    id: orgId,
    name: "E2E Test Org",
  });
  if (orgError) throw new Error(`Failed to create org: ${orgError.message}`);

  const { error: teamError } = await admin.from("teams").insert({
    id: teamId,
    name: TEST_TEAM_NAME,
    organization_id: orgId,
    owner_id: coach.id,
  });
  if (teamError) throw new Error(`Failed to create team: ${teamError.message}`);

  // Add coach (owner), manager (non-owner admin), and player as members
  const { error: membersError } = await admin.from("team_members").insert([
    { team_id: teamId, profile_id: coach.id, role: "coach" },
    { team_id: teamId, profile_id: manager.id, role: "manager" },
    { team_id: teamId, profile_id: player.id, role: "player" },
  ]);
  if (membersError) throw new Error(`Failed to add members: ${membersError.message}`);

  // Create a future event
  const start = new Date();
  start.setDate(start.getDate() + 7);
  start.setHours(18, 0, 0, 0);
  const end = new Date(start);
  end.setHours(20, 0, 0, 0);

  const { data: eventData, error: eventError } = await admin
    .from("events")
    .insert({
      team_id: teamId,
      title: "E2E Test Game",
      event_type: "game",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      created_by: coach.id,
    })
    .select("id")
    .single();
  if (eventError) throw new Error(`Failed to create event: ${eventError.message}`);
  const eventId = eventData.id;

  // Create an invitation for the invitee
  const invitationId = crypto.randomUUID();
  const { error: inviteError } = await admin.from("invitations").insert({
    id: invitationId,
    team_id: teamId,
    email: TEST_INVITEE_EMAIL,
    role: "player",
    invited_by: coach.id,
  });
  if (inviteError) throw new Error(`Failed to create invitation: ${inviteError.message}`);

  // Write IDs to a shared state file for use in tests
  const state = { orgId, teamId, eventId, invitationId, managerId: manager.id };
  const fs = await import("fs");
  fs.writeFileSync("tests/e2e/.state.json", JSON.stringify(state, null, 2));

  console.log("✓ E2E global setup complete");
}

async function createUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to create user ${email}: ${error.message}`);
  return data.user;
}

async function cleanupTestData() {
  // Find and delete test users — cascades to team_members, events, etc.
  for (const email of [TEST_COACH_EMAIL, TEST_MANAGER_EMAIL, TEST_PLAYER_EMAIL, TEST_INVITEE_EMAIL]) {
    const { data } = await admin.auth.admin.listUsers();
    const user = data?.users.find((u) => u.email === email);
    if (user) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }

  // Delete test teams/orgs by name
  const { data: orgs } = await admin
    .from("organizations")
    .select("id")
    .eq("name", "E2E Test Org");
  if (orgs?.length) {
    await admin.from("organizations").delete().in("id", orgs.map((o) => o.id));
  }

  // Clean up state file
  const fs = await import("fs");
  if (fs.existsSync("tests/e2e/.state.json")) {
    fs.unlinkSync("tests/e2e/.state.json");
  }
}

export default globalSetup;
