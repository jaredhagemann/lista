import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env.local.test") });

const FIXTURES_FILE = path.join(__dirname, ".fixtures.json");

export default async function globalTeardown() {
  if (!fs.existsSync(FIXTURES_FILE)) return;

  const fixtures = JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf-8")) as {
    userAId: string;
    userBId: string;
    orgId: string;
    teamId: string;
    inviteId: string;
    managedProfileId: string;
    managerInviteId: string;
  };
  const { userAId, userBId, orgId, teamId, inviteId, managedProfileId, managerInviteId } = fixtures;

  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Delete in FK-safe order
  await admin.from("profile_managers").delete().eq("managed_id", managedProfileId);
  await admin.from("team_members").delete().match({ team_id: teamId, profile_id: userAId });
  await admin.from("invitations").delete().in("id", [inviteId, managerInviteId]);
  await admin.from("profiles").delete().eq("id", managedProfileId);
  await admin.from("teams").delete().eq("id", teamId);
  await admin.from("organizations").delete().eq("id", orgId);
  await admin.auth.admin.deleteUser(userAId);
  await admin.auth.admin.deleteUser(userBId);

  fs.unlinkSync(FIXTURES_FILE);
}
