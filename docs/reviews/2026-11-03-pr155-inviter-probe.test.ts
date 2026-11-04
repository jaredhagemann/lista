/** Review probe: an invitation ID need not come from the recipient's inbox. */
import { vi, it, expect, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

vi.mock("@/lib/rate-limit", () => ({
  inviteSignupLimiter: { limit: vi.fn(async () => ({ success: true })) },
  rateLimitResponse: () => new Response("{}", { status: 429 }),
}));

import { POST } from "@/app/api/auth/invite-signup/route";
import { adminClient, createTestUser, createTestTeam, cleanupTestData } from "../../tests/rls/helpers";

let victimId: string | undefined;
let teamId: string | undefined;
afterAll(async () => {
  if (teamId) await adminClient.from("invitations").delete().eq("team_id", teamId);
  if (victimId) await adminClient.auth.admin.deleteUser(victimId);
  await cleanupTestData();
});

it("an authenticated inviter can create a confirmed victim account without an email round trip", async () => {
  const attacker = await createTestUser();
  ({ teamId } = await createTestTeam(attacker.user.id));
  const victimEmail = `pr155-victim-${crypto.randomUUID()}@test.local`;
  const inviteId = crypto.randomUUID();
  const password = "attacker-chosen-password-123!";

  // Use the attacker's ordinary session, not the service-role client. No email
  // is sent, and the attacker supplies/knows the invitation ID.
  const { error: insertError } = await attacker.client.from("invitations").insert({
    id: inviteId,
    team_id: teamId,
    email: victimEmail,
    role: "player",
    invited_by: attacker.user.id,
  });
  expect(insertError).toBeNull();

  const response = await POST(new Request("http://localhost/api/auth/invite-signup", {
    method: "POST",
    body: JSON.stringify({ inviteId, password }),
  }));

  // Find any created user before assertions so a failure still cleans up.
  const { data: profile } = await adminClient.from("profiles").select("id").eq("email", victimEmail).maybeSingle();
  victimId = profile?.id;
  expect(response.status).toBe(200);
  expect(victimId).toBeTruthy();
  const { data: auth } = await adminClient.auth.admin.getUserById(victimId!);
  expect(auth.user?.email_confirmed_at).toBeTruthy();

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: victimEmail, password });
  expect(error).toBeNull();
  expect(data.user?.id).toBe(victimId);
});
