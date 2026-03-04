import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_EMAILS = [
  "e2e-coach@lista.test",
  "e2e-player@lista.test",
  "e2e-invitee@lista.test",
];

async function globalTeardown() {
  // Delete test users
  for (const email of TEST_EMAILS) {
    const { data } = await admin.auth.admin.listUsers();
    const user = data?.users.find((u) => u.email === email);
    if (user) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }

  // Delete test org (cascades to teams, events, etc.)
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

  console.log("✓ E2E global teardown complete");
}

export default globalTeardown;
