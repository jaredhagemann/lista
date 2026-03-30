import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env.local.test") });

const FIXTURES_FILE = path.join(__dirname, ".fixtures.json");

export default async function globalSetup() {
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const ts = Date.now();
  const emailA = `mw-test-a-${ts}@lista-test.example`;
  const emailB = `mw-test-b-${ts}@lista-test.example`;
  const password = "TestPass1234!";

  // Create two test users
  const { data: dataA, error: errA } = await admin.auth.admin.createUser({
    email: emailA,
    password,
    email_confirm: true,
  });
  if (errA || !dataA.user) {
    throw new Error(`Failed to create user A: ${errA?.message}`);
  }

  const { data: dataB, error: errB } = await admin.auth.admin.createUser({
    email: emailB,
    password,
    email_confirm: true,
  });
  if (errB || !dataB.user) {
    // Roll back user A before throwing
    await admin.auth.admin.deleteUser(dataA.user.id);
    throw new Error(`Failed to create user B: ${errB?.message}`);
  }

  const userAId = dataA.user.id;
  const userBId = dataB.user.id;

  // Create org and team
  const orgId = crypto.randomUUID();
  const { error: orgErr } = await admin
    .from("organizations")
    .insert({ id: orgId, name: `Test Org ${ts}` });
  if (orgErr) throw new Error(`Failed to create org: ${orgErr.message}`);

  const teamId = crypto.randomUUID();
  const { error: teamErr } = await admin
    .from("teams")
    .insert({ id: teamId, name: `Test Team ${ts}`, organization_id: orgId });
  if (teamErr) throw new Error(`Failed to create team: ${teamErr.message}`);

  // Create self-type invitation for user A's email
  const inviteId = crypto.randomUUID();
  const { error: inviteErr } = await admin.from("invitations").insert({
    id: inviteId,
    email: emailA,
    team_id: teamId,
    role: "player",
  });
  if (inviteErr) throw new Error(`Failed to create invitation: ${inviteErr.message}`);

  // Create a managed profile (no auth account) for the manager-invite fixture
  const managedProfileId = crypto.randomUUID();
  const { error: managedProfileErr } = await admin.from("profiles").insert({
    id: managedProfileId,
    first_name: "Managed",
    last_name: "Player",
    email: `managed-${managedProfileId.slice(0, 8)}@lista-test.example`,
  });
  if (managedProfileErr) throw new Error(`Failed to create managed profile: ${managedProfileErr.message}`);

  // Create manager-type invitation for user A's email pointing at the managed profile
  const managerInviteId = crypto.randomUUID();
  const { error: managerInviteErr } = await admin.from("invitations").insert({
    id: managerInviteId,
    email: emailA,
    managed_profile_id: managedProfileId,
    role: "manager",
    relationship: "parent",
  });
  if (managerInviteErr) throw new Error(`Failed to create manager invitation: ${managerInviteErr.message}`);

  fs.writeFileSync(
    FIXTURES_FILE,
    JSON.stringify(
      { userAId, userBId, emailA, emailB, password, orgId, teamId, inviteId, managedProfileId, managerInviteId },
      null,
      2
    )
  );
}
