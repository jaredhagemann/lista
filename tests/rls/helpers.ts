import { createClient, SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Admin client that bypasses RLS */
export const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Track created resources for cleanup
const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];
const createdTeamIds: string[] = [];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Create a test user, sign in, and return an authenticated client */
export async function createTestUser(
  email?: string,
  fullName?: string
): Promise<{ client: SupabaseClient; user: { id: string; email: string } }> {
  const testEmail = email || `test-${crypto.randomUUID()}@test.local`;
  const password = "test-password-123!";

  const { data, error } = await adminClient.auth.admin.createUser({
    email: testEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || "Test User" },
  });

  if (error) throw new Error(`Failed to create test user: ${error.message}`);

  createdUserIds.push(data.user.id);

  // Sign in with retry + backoff to handle Supabase auth rate limits
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let signInError: Error | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await delay(1000 * attempt);
    const { error } = await userClient.auth.signInWithPassword({
      email: testEmail,
      password,
    });
    if (!error) {
      signInError = null;
      break;
    }
    signInError = error;
  }

  if (signInError) throw new Error(`Failed to sign in test user: ${signInError.message}`);

  return {
    client: userClient,
    user: { id: data.user.id, email: testEmail },
  };
}

/** Create a test team (with org) via admin client, add coach membership */
export async function createTestTeam(
  coachUserId: string
): Promise<{ orgId: string; teamId: string }> {
  const orgId = crypto.randomUUID();
  const teamId = crypto.randomUUID();

  const { error: orgError } = await adminClient
    .from("organizations")
    .insert({ id: orgId, name: `Test Org ${orgId.slice(0, 8)}` });
  if (orgError) throw new Error(`Failed to create org: ${orgError.message}`);
  createdOrgIds.push(orgId);

  const { error: teamError } = await adminClient
    .from("teams")
    .insert({ id: teamId, organization_id: orgId, name: `Test Team ${teamId.slice(0, 8)}` });
  if (teamError) throw new Error(`Failed to create team: ${teamError.message}`);
  createdTeamIds.push(teamId);

  const { error: memberError } = await adminClient
    .from("team_members")
    .insert({ team_id: teamId, profile_id: coachUserId, role: "coach" });
  if (memberError) throw new Error(`Failed to add coach: ${memberError.message}`);

  return { orgId, teamId };
}

/** Add a member to a team via admin client */
export async function addTeamMember(
  teamId: string,
  profileId: string,
  role: "coach" | "manager" | "parent" | "player" = "player"
) {
  const { error } = await adminClient
    .from("team_members")
    .insert({ team_id: teamId, profile_id: profileId, role });
  if (error) throw new Error(`Failed to add team member: ${error.message}`);
}

/** Clean up all test data in correct FK order */
export async function cleanupTestData() {
  // Delete in reverse dependency order
  for (const teamId of createdTeamIds) {
    await adminClient.from("availability").delete().in(
      "event_id",
      (await adminClient.from("events").select("id").eq("team_id", teamId)).data?.map(
        (e) => e.id
      ) || []
    );
    await adminClient.from("events").delete().eq("team_id", teamId);
    await adminClient.from("invitations").delete().eq("team_id", teamId);
    await adminClient.from("team_members").delete().eq("team_id", teamId);
    await adminClient.from("teams").delete().eq("id", teamId);
  }

  for (const orgId of createdOrgIds) {
    await adminClient.from("organizations").delete().eq("id", orgId);
  }

  for (const userId of createdUserIds) {
    await adminClient.from("push_subscriptions").delete().eq("profile_id", userId);
    await adminClient.from("notification_preferences").delete().eq("profile_id", userId);
    await adminClient.from("profiles").delete().eq("id", userId);
    await adminClient.auth.admin.deleteUser(userId);
  }

  // Clear tracking arrays
  createdUserIds.length = 0;
  createdOrgIds.length = 0;
  createdTeamIds.length = 0;
}
