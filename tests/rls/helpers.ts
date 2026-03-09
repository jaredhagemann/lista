import { createClient, SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.test.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

if (!SUPABASE_URL.includes("127.0.0.1") && !SUPABASE_URL.includes("localhost")) {
  throw new Error(
    "RLS tests must run against a local Supabase instance.\n" +
      "Set NEXT_PUBLIC_SUPABASE_URL to http://127.0.0.1:54321 in .env.test.local.\n" +
      "Run `supabase start` to start the local stack."
  );
}
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
    user_metadata: { first_name: fullName || "Test User" },
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
  role: "coach" | "manager" | "player" = "player"
) {
  const { error } = await adminClient
    .from("team_members")
    .insert({ team_id: teamId, profile_id: profileId, role });
  if (error) throw new Error(`Failed to add team member: ${error.message}`);
}

const createdManagedProfileIds: string[] = [];

/**
 * Create a managed profile (no auth account) via admin client.
 * Returns the profile ID.
 */
export async function createManagedProfile(
  managerId: string,
  opts: { firstName?: string; lastName?: string; relationship?: string } = {}
): Promise<string> {
  const profileId = crypto.randomUUID();
  const { error: profileError } = await adminClient.from("profiles").insert({
    id: profileId,
    first_name: opts.firstName ?? "Managed",
    last_name: opts.lastName ?? "Player",
    email: `managed-${profileId.slice(0, 8)}@lista.internal`,
  });
  if (profileError) throw new Error(`Failed to create managed profile: ${profileError.message}`);
  createdManagedProfileIds.push(profileId);

  const { error: linkError } = await adminClient.from("profile_managers").insert({
    manager_id: managerId,
    managed_id: profileId,
    relationship: opts.relationship ?? null,
  });
  if (linkError) throw new Error(`Failed to link managed profile: ${linkError.message}`);

  return profileId;
}

/** Clean up all test data in correct FK order */
export async function cleanupTestData() {
  // Delete managed profiles and their manager links
  for (const profileId of createdManagedProfileIds) {
    await adminClient.from("profile_managers").delete().eq("managed_id", profileId);
    await adminClient.from("team_members").delete().eq("profile_id", profileId);
    await adminClient.from("availability").delete().eq("profile_id", profileId);
    await adminClient.from("profiles").delete().eq("id", profileId);
  }

  // Delete in reverse dependency order
  for (const teamId of createdTeamIds) {
    // Chat tables: messages → channel_members / dm_channels → channels
    const { data: teamChannels } = await adminClient
      .from("channels")
      .select("id")
      .eq("team_id", teamId);
    const channelIds = teamChannels?.map((c) => c.id) ?? [];
    if (channelIds.length > 0) {
      await adminClient.from("messages").delete().in("channel_id", channelIds);
      await adminClient.from("channel_members").delete().in("channel_id", channelIds);
    }
    await adminClient.from("messages").delete().eq(
      "dm_channel_id",
      (await adminClient.from("dm_channels").select("id").eq("team_id", teamId)).data?.map((d) => d.id)[0] ?? ""
    );
    await adminClient.from("dm_channels").delete().eq("team_id", teamId);
    await adminClient.from("channels").delete().eq("team_id", teamId);

    await adminClient.from("availability").delete().in(
      "event_id",
      (await adminClient.from("events").select("id").eq("team_id", teamId)).data?.map(
        (e) => e.id
      ) || []
    );
    await adminClient.from("events").delete().eq("team_id", teamId);
    await adminClient.from("locations").delete().eq("team_id", teamId);
    await adminClient.from("invitations").delete().eq("team_id", teamId);
    await adminClient.from("team_members").delete().eq("team_id", teamId);
    await adminClient.from("teams").delete().eq("id", teamId);
  }

  for (const orgId of createdOrgIds) {
    await adminClient.from("organizations").delete().eq("id", orgId);
  }

  for (const userId of createdUserIds) {
    await adminClient.from("contacts").delete().eq("profile_id", userId);
    await adminClient.from("push_subscriptions").delete().eq("profile_id", userId);
    await adminClient.from("notification_preferences").delete().eq("profile_id", userId);
    await adminClient.from("profiles").delete().eq("id", userId);
    await adminClient.auth.admin.deleteUser(userId);
  }

  // Clear tracking arrays
  createdUserIds.length = 0;
  createdOrgIds.length = 0;
  createdTeamIds.length = 0;
  createdManagedProfileIds.length = 0;
}
