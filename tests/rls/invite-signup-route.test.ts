/**
 * Integration tests for POST /api/auth/invite-signup (BUG-044).
 *
 * The route creates an account with its email already confirmed, on the grounds
 * that the invite link proved the address. So it must have a real pending
 * invitation, and the account must be for that invitation's email. Otherwise
 * anyone could create a confirmed account for someone else's address, and keep
 * the password after that person later signs in with Google.
 *
 * Exercises the REAL route against the local Supabase stack. Only the rate limit,
 * which needs Redis, is mocked.
 *
 * Requires the local Supabase stack. Run with: pnpm test:rls
 */

import { vi, describe, it, expect, afterAll, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

vi.mock("@/lib/rate-limit", () => ({
  signupLimiter: { limit: vi.fn(async () => ({ success: true })) },
  inviteSignupLimiter: { limit: vi.fn(async () => ({ success: true })) },
  rateLimitResponse: () => new Response("{}", { status: 429 }),
}));

import { POST } from "@/app/api/auth/invite-signup/route";
import { adminClient, createTestUser, createTestTeam, cleanupTestData } from "./helpers";

const PASSWORD = "invite-signup-123!";
const createdUserIds: string[] = [];
let teamId: string;
let inviterId: string;

const uniqueEmail = (label: string) => `invite-signup-${label}-${crypto.randomUUID()}@test.local`;

async function findUser(email: string) {
  const { data } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (!data) return null;
  createdUserIds.push(data.id);
  const { data: auth } = await adminClient.auth.admin.getUserById(data.id);
  return auth.user;
}

async function createInvitation(email: string, extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const { error } = await adminClient.from("invitations").insert({
    id,
    team_id: teamId,
    email,
    role: "player",
    invited_by: inviterId,
    ...extra,
  });
  if (error) throw new Error(error.message);
  return id;
}

const signup = (body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost/api/auth/invite-signup", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD, ...body }),
    }),
  );

beforeAll(async () => {
  const { user } = await createTestUser();
  inviterId = user.id;
  ({ teamId } = await createTestTeam(user.id));
});

afterAll(async () => {
  await adminClient.from("invitations").delete().eq("team_id", teamId);
  for (const id of createdUserIds) await adminClient.auth.admin.deleteUser(id);
  await cleanupTestData();
});

describe("refused", () => {
  it("won't create an account for an email nobody invited", async () => {
    const email = uniqueEmail("uninvited");

    const res = await signup({ email });

    expect(res.status).toBe(403);
    expect(await findUser(email)).toBeNull();
  });

  it("won't create one from an invitation id that doesn't exist", async () => {
    const email = uniqueEmail("unknown-id");

    const res = await signup({ inviteId: crypto.randomUUID(), email });

    expect(res.status).toBe(403);
    expect(await findUser(email)).toBeNull();
  });

  it("won't create one from something that isn't an id", async () => {
    const email = uniqueEmail("malformed-id");

    const res = await signup({ inviteId: "not-a-uuid", email });

    expect(res.status).toBe(403);
    expect(await findUser(email)).toBeNull();
  });

  it("won't use someone else's invitation to create an account for another email", async () => {
    const invited = uniqueEmail("invited");
    const other = uniqueEmail("other");
    const inviteId = await createInvitation(invited);

    await signup({ inviteId, email: other });

    expect(await findUser(other)).toBeNull();
  });

  it("won't use an invitation that was already accepted", async () => {
    const email = uniqueEmail("accepted");
    const inviteId = await createInvitation(email, { accepted_at: new Date().toISOString() });

    const res = await signup({ inviteId, email });

    expect(res.status).toBe(403);
    expect(await findUser(email)).toBeNull();
  });

  it("gives the same answer whichever reason it refused for", async () => {
    const accepted = await createInvitation(uniqueEmail("same-a"), {
      accepted_at: new Date().toISOString(),
    });

    const responses = await Promise.all([
      signup({ inviteId: crypto.randomUUID() }),
      signup({ inviteId: accepted }),
      signup({}),
    ]);

    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(new Set(bodies.map((b) => b.error)).size).toBe(1);
  });
});

describe("a real invitation", () => {
  it("creates a confirmed account for the invited email, who can sign in", async () => {
    const email = uniqueEmail("real");
    const inviteId = await createInvitation(email);

    const res = await signup({ inviteId, firstName: "Jane", lastName: "Smith" });

    expect(res.status).toBe(200);
    const user = await findUser(email);
    expect(user?.email_confirmed_at).toBeTruthy();
    expect(user?.user_metadata).toMatchObject({ first_name: "Jane", last_name: "Smith" });

    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    expect(error).toBeNull();
  });

  it("works when the invitation's email has capitals in it", async () => {
    const email = uniqueEmail("capitals");
    const inviteId = await createInvitation(`Parent.${email}`);

    const res = await signup({ inviteId });

    expect(res.status).toBe(200);
    expect(await findUser(`parent.${email}`)).not.toBeNull();
  });

  it("says the account already exists when it does, so the form can offer sign-in", async () => {
    const email = uniqueEmail("existing");
    const inviteId = await createInvitation(email);
    await signup({ inviteId });
    await findUser(email);

    const res = await signup({ inviteId });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("already_exists");
  });

  it("still asks for a password", async () => {
    const email = uniqueEmail("no-password");
    const inviteId = await createInvitation(email);

    const res = await signup({ inviteId, password: "" });

    expect(res.status).toBe(400);
    expect(await findUser(email)).toBeNull();
  });
});
