/**
 * Integration tests for invitation acceptance (BUG-012).
 *
 * Exercises the REAL web server actions (acceptInvitationAsSelf,
 * acceptInvitationAsGuardian, acceptManagerInvitation) and the REAL
 * POST /api/invite/[id]/accept route against the local Supabase stack. Only the
 * cookie session and Next.js request-scope helpers are mocked.
 *
 * Server actions are callable directly from the browser, so the checks the
 * invite page performs are not a protection. Acceptance itself must:
 *   - verify the signed-in user is the invitation's recipient (email,
 *     case-insensitive)
 *   - accept an invitation only through the path matching its kind. A guardian
 *     invitation is stored with role "manager", the same string as the team
 *     manager staff role, so accepting it as "self" used to grant team staff
 *     access.
 *   - be one-time, including under concurrent acceptance
 *
 * Requires the local Supabase stack. Run with: pnpm test:rls
 */

import { vi, describe, it, expect, afterAll, beforeEach } from "vitest";

const session = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: session.user } })) },
  })),
}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/dist/server/web/spec-extension/revalidate", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import {
  acceptInvitationAsSelf,
  acceptInvitationAsGuardian,
  acceptManagerInvitation,
} from "@/app/actions/invite";
import { POST as acceptRoute } from "@/app/api/invite/[id]/accept/route";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  createManagedProfile,
  cleanupTestData,
} from "./helpers";

// Guardian acceptance creates player profiles the shared helpers don't track.
// A sole guardian can't be deleted while their player exists (BUG-002), so
// remove those players before the shared cleanup deletes the test users.
const signedInUserIds = new Set<string>();

afterAll(async () => {
  for (const userId of signedInUserIds) {
    for (const link of await guardianLinksFrom(userId)) {
      await adminClient.from("profiles").delete().eq("id", link.managed_id).is("auth_user_id", null);
    }
  }
  await cleanupTestData();
});

beforeEach(() => {
  session.user = null;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

function signInAs(user: TestUser) {
  signedInUserIds.add(user.user.id);
  session.user = { id: user.user.id, email: user.user.email };
}

async function createInvitation(opts: {
  teamId: string;
  email: string;
  role: "coach" | "manager" | "player";
  managedProfileId?: string;
  firstName?: string;
  lastName?: string;
}) {
  const id = crypto.randomUUID();
  const { error } = await adminClient.from("invitations").insert({
    id,
    team_id: opts.teamId,
    email: opts.email,
    role: opts.role,
    managed_profile_id: opts.managedProfileId ?? null,
    relationship: opts.managedProfileId ? "Guardian" : null,
    first_name: opts.firstName ?? null,
    last_name: opts.lastName ?? null,
  });
  if (error) throw new Error(`Failed to create invitation: ${error.message}`);
  return id;
}

async function isPending(invitationId: string) {
  const { data } = await adminClient
    .from("invitations")
    .select("accepted_at")
    .eq("id", invitationId)
    .single();
  return data!.accepted_at === null;
}

async function membership(teamId: string, profileId: string) {
  const { data } = await adminClient
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("profile_id", profileId)
    .maybeSingle();
  return data;
}

/** Guardian links from this user to anyone other than themselves. */
async function guardianLinksFrom(userId: string) {
  const { data } = await adminClient
    .from("profile_managers")
    .select("managed_id, relationship")
    .eq("manager_id", userId)
    .neq("managed_id", userId);
  return data ?? [];
}

function routeRequest(invitationId: string, type: "self" | "manager") {
  return acceptRoute(
    new Request(`http://localhost/api/invite/${invitationId}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    }),
    { params: Promise.resolve({ id: invitationId }) }
  );
}

async function teamWithCoach() {
  const coach = await createTestUser();
  const { teamId } = await createTestTeam(coach.user.id);
  return { coach, teamId };
}

async function guardianInvitation(recipientEmail: string) {
  const { teamId } = await teamWithCoach();
  const parent = await createTestUser();
  const childId = await createManagedProfile(parent.user.id);
  await addTeamMember(teamId, childId, "player");
  const invitationId = await createInvitation({
    teamId,
    email: recipientEmail,
    role: "manager",
    managedProfileId: childId,
  });
  return { teamId, childId, invitationId };
}

// ── Recipient ─────────────────────────────────────────────────────────────────

describe("invitation acceptance — only the invited person may accept (BUG-012)", () => {
  it("acceptInvitationAsSelf refuses someone else's invitation", async () => {
    const { teamId } = await teamWithCoach();
    const invitee = await createTestUser();
    const outsider = await createTestUser();
    const invitationId = await createInvitation({ teamId, email: invitee.user.email, role: "coach" });

    signInAs(outsider);
    const result = await acceptInvitationAsSelf(invitationId);

    expect(result).toHaveProperty("error");
    expect(await membership(teamId, outsider.user.id)).toBeNull();
    expect(await isPending(invitationId)).toBe(true);
  });

  it("acceptInvitationAsGuardian refuses someone else's invitation", async () => {
    const { teamId } = await teamWithCoach();
    const invitee = await createTestUser();
    const outsider = await createTestUser();
    const invitationId = await createInvitation({
      teamId,
      email: invitee.user.email,
      role: "player",
      firstName: "Kid",
      lastName: "Invited",
    });

    signInAs(outsider);
    const result = await acceptInvitationAsGuardian(invitationId, { relationship: "Parent" });

    expect(result).toHaveProperty("error");
    expect(await guardianLinksFrom(outsider.user.id)).toHaveLength(0);
    expect(await isPending(invitationId)).toBe(true);
  });

  it("acceptManagerInvitation refuses someone else's guardian invitation", async () => {
    const invitee = await createTestUser();
    const outsider = await createTestUser();
    const { invitationId } = await guardianInvitation(invitee.user.email);

    signInAs(outsider);
    const result = await acceptManagerInvitation(invitationId);

    expect(result).toHaveProperty("error");
    expect(await guardianLinksFrom(outsider.user.id)).toHaveLength(0);
    expect(await isPending(invitationId)).toBe(true);
  });

  it("the API route refuses someone else's invitation with 403", async () => {
    const { teamId } = await teamWithCoach();
    const invitee = await createTestUser();
    const outsider = await createTestUser();
    const invitationId = await createInvitation({ teamId, email: invitee.user.email, role: "player" });

    signInAs(outsider);
    const res = await routeRequest(invitationId, "self");

    expect(res.status).toBe(403);
    expect(await membership(teamId, outsider.user.id)).toBeNull();
    expect(await isPending(invitationId)).toBe(true);
  });

  it("compares the recipient email case-insensitively", async () => {
    const { teamId } = await teamWithCoach();
    const invitee = await createTestUser();
    const invitationId = await createInvitation({
      teamId,
      email: `  ${invitee.user.email.toUpperCase()} `,
      role: "player",
    });

    signInAs(invitee);
    const result = await acceptInvitationAsSelf(invitationId);

    expect(result).toMatchObject({ success: true });
    expect(await membership(teamId, invitee.user.id)).toEqual({ role: "player" });
  });
});

// ── Invitation kind ───────────────────────────────────────────────────────────

describe("invitation acceptance — path must match the invitation kind (BUG-012)", () => {
  it("acceptInvitationAsSelf refuses a guardian invitation instead of granting team manager", async () => {
    const recipient = await createTestUser();
    const { teamId, invitationId } = await guardianInvitation(recipient.user.email);

    signInAs(recipient);
    const result = await acceptInvitationAsSelf(invitationId);

    expect(result).toHaveProperty("error");
    expect(await membership(teamId, recipient.user.id)).toBeNull();
    expect(await isPending(invitationId)).toBe(true);
  });

  it("the API route refuses type=self on a guardian invitation instead of granting team manager", async () => {
    const recipient = await createTestUser();
    const { teamId, invitationId } = await guardianInvitation(recipient.user.email);

    signInAs(recipient);
    const res = await routeRequest(invitationId, "self");

    expect(res.status).toBe(400);
    expect(await membership(teamId, recipient.user.id)).toBeNull();
    expect(await isPending(invitationId)).toBe(true);
  });

  it("acceptInvitationAsGuardian refuses a coach invitation", async () => {
    const { teamId } = await teamWithCoach();
    const recipient = await createTestUser();
    const invitationId = await createInvitation({ teamId, email: recipient.user.email, role: "coach" });

    signInAs(recipient);
    const result = await acceptInvitationAsGuardian(invitationId, { relationship: "Parent" });

    expect(result).toHaveProperty("error");
    expect(await guardianLinksFrom(recipient.user.id)).toHaveLength(0);
    expect(await isPending(invitationId)).toBe(true);
  });

  it("acceptInvitationAsGuardian refuses a guardian invitation for an existing player", async () => {
    const recipient = await createTestUser();
    const { invitationId } = await guardianInvitation(recipient.user.email);

    signInAs(recipient);
    const result = await acceptInvitationAsGuardian(invitationId, { relationship: "Parent" });

    expect(result).toHaveProperty("error");
    expect(await guardianLinksFrom(recipient.user.id)).toHaveLength(0);
    expect(await isPending(invitationId)).toBe(true);
  });

  it("acceptManagerInvitation refuses a plain player invitation", async () => {
    const { teamId } = await teamWithCoach();
    const recipient = await createTestUser();
    const invitationId = await createInvitation({ teamId, email: recipient.user.email, role: "player" });

    signInAs(recipient);
    const result = await acceptManagerInvitation(invitationId);

    expect(result).toHaveProperty("error");
    expect(await isPending(invitationId)).toBe(true);
  });

  it("the API route refuses type=manager on a plain player invitation with 400", async () => {
    const { teamId } = await teamWithCoach();
    const recipient = await createTestUser();
    const invitationId = await createInvitation({ teamId, email: recipient.user.email, role: "player" });

    signInAs(recipient);
    const res = await routeRequest(invitationId, "manager");

    expect(res.status).toBe(400);
    expect(await isPending(invitationId)).toBe(true);
  });
});

// ── One-time acceptance ───────────────────────────────────────────────────────

describe("invitation acceptance — one time only (BUG-012)", () => {
  it("concurrent guardian acceptance creates exactly one player", async () => {
    const { teamId } = await teamWithCoach();
    const recipient = await createTestUser();
    const invitationId = await createInvitation({
      teamId,
      email: recipient.user.email,
      role: "player",
      firstName: "Only",
      lastName: "Once",
    });

    signInAs(recipient);
    const results = await Promise.all([
      acceptInvitationAsGuardian(invitationId, { relationship: "Parent" }),
      acceptInvitationAsGuardian(invitationId, { relationship: "Parent" }),
    ]);

    expect(results.filter((r) => "success" in r && r.success)).toHaveLength(1);
    expect(await guardianLinksFrom(recipient.user.id)).toHaveLength(1);
  });

  it("a second acceptance is refused and changes nothing", async () => {
    const { teamId } = await teamWithCoach();
    const recipient = await createTestUser();
    const invitationId = await createInvitation({ teamId, email: recipient.user.email, role: "player" });

    signInAs(recipient);
    expect(await acceptInvitationAsGuardian(invitationId, { relationship: "Parent" })).toMatchObject({
      success: true,
    });
    const second = await acceptInvitationAsGuardian(invitationId, { relationship: "Parent" });

    expect(second).toHaveProperty("error");
    expect(await guardianLinksFrom(recipient.user.id)).toHaveLength(1);
  });
});

// ── Complete admission → invitation → acceptance sequence ─────────────────────

describe("guardianship cannot be manufactured through a fabricated roster row (BUG-002 review, finding 1)", () => {
  it("a coach cannot add someone else's child to their team, invite themselves as guardian, and accept", async () => {
    const { teamId: realTeamId } = await teamWithCoach();
    const parent = await createTestUser();
    const attacker = await createTestUser();
    const { teamId: attackerTeamId } = await createTestTeam(attacker.user.id);
    const childId = await createManagedProfile(parent.user.id);
    await addTeamMember(realTeamId, childId, "player");

    // 1. Fabricate the membership the staff invitation check trusts.
    const { error: admissionError } = await attacker.client
      .from("team_members")
      .insert({ team_id: attackerTeamId, profile_id: childId, role: "player" });
    expect(admissionError).not.toBeNull();

    // 2. Re-point the attacker's own roster row at the child instead.
    await attacker.client
      .from("team_members")
      .update({ profile_id: childId })
      .eq("team_id", attackerTeamId)
      .eq("profile_id", attacker.user.id);
    expect(await membership(attackerTeamId, childId)).toBeNull();

    // 3. Invite themselves as the child's guardian.
    const invitationId = crypto.randomUUID();
    const { error: inviteError } = await attacker.client.from("invitations").insert({
      id: invitationId,
      team_id: attackerTeamId,
      email: attacker.user.email,
      role: "manager",
      managed_profile_id: childId,
      invited_by: attacker.user.id,
    });
    expect(inviteError).not.toBeNull();

    // 4. No guardianship, and no access to the child's real team.
    expect(await guardianLinksFrom(attacker.user.id)).toHaveLength(0);
    const { data: canSeeRealTeam } = await attacker.client.rpc("is_team_member", { t_id: realTeamId });
    expect(canSeeRealTeam).toBe(false);
  });
});

// ── Database function ─────────────────────────────────────────────────────────

describe("accept_invitation — service role only (BUG-012)", () => {
  it("is not callable from a client session, which could otherwise name any user", async () => {
    const { teamId } = await teamWithCoach();
    const recipient = await createTestUser();
    const attacker = await createTestUser();
    const invitationId = await createInvitation({ teamId, email: recipient.user.email, role: "coach" });

    const { error } = await attacker.client.rpc("accept_invitation", {
      p_invitation_id: invitationId,
      p_user_id: recipient.user.id,
      p_mode: "self",
    });

    expect(error).not.toBeNull();
    expect(await isPending(invitationId)).toBe(true);
  });
});

// ── Legitimate acceptance ─────────────────────────────────────────────────────

describe("invitation acceptance — the invited person can still accept (BUG-012)", () => {
  it("acceptInvitationAsSelf joins the team with the invitation's role", async () => {
    const { teamId } = await teamWithCoach();
    const recipient = await createTestUser();
    const invitationId = await createInvitation({ teamId, email: recipient.user.email, role: "coach" });

    signInAs(recipient);
    const result = await acceptInvitationAsSelf(invitationId);

    expect(result).toMatchObject({ success: true });
    expect(result).toHaveProperty("memberId");
    expect(await membership(teamId, recipient.user.id)).toEqual({ role: "coach" });
    expect(await isPending(invitationId)).toBe(false);
  });

  it("acceptInvitationAsGuardian creates the player, links the guardian and adds the player to the team", async () => {
    const { teamId } = await teamWithCoach();
    const recipient = await createTestUser();
    const invitationId = await createInvitation({
      teamId,
      email: recipient.user.email,
      role: "player",
      firstName: "Ava",
      lastName: "Smith",
    });

    signInAs(recipient);
    const result = await acceptInvitationAsGuardian(invitationId, { relationship: "Mom" });

    expect(result).toMatchObject({ success: true });
    const links = await guardianLinksFrom(recipient.user.id);
    expect(links).toHaveLength(1);
    expect(links[0].relationship).toBe("Mom");
    const { data: player } = await adminClient
      .from("profiles")
      .select("first_name, last_name, auth_user_id")
      .eq("id", links[0].managed_id)
      .single();
    expect(player).toEqual({ first_name: "Ava", last_name: "Smith", auth_user_id: null });
    expect(await membership(teamId, links[0].managed_id)).toEqual({ role: "player" });
    expect(await isPending(invitationId)).toBe(false);
  });

  it("acceptManagerInvitation links the recipient to the existing player", async () => {
    const recipient = await createTestUser();
    const { childId, invitationId } = await guardianInvitation(recipient.user.email);

    signInAs(recipient);
    const result = await acceptManagerInvitation(invitationId);

    expect(result).toMatchObject({ success: true });
    expect((await guardianLinksFrom(recipient.user.id)).map((l) => l.managed_id)).toEqual([childId]);
    expect(await isPending(invitationId)).toBe(false);
  });

  it("the API route accepts type=self and type=manager for the recipient", async () => {
    const { teamId } = await teamWithCoach();
    const recipient = await createTestUser();
    const selfInvite = await createInvitation({ teamId, email: recipient.user.email, role: "player" });
    const { childId, invitationId: guardianInvite } = await guardianInvitation(recipient.user.email);

    signInAs(recipient);
    expect((await routeRequest(selfInvite, "self")).status).toBe(200);
    expect((await routeRequest(guardianInvite, "manager")).status).toBe(200);

    expect(await membership(teamId, recipient.user.id)).toEqual({ role: "player" });
    expect((await guardianLinksFrom(recipient.user.id)).map((l) => l.managed_id)).toEqual([childId]);
  });
});
