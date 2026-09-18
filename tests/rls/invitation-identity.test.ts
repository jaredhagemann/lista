/**
 * One child, one identity (BUG-011).
 *
 * Guardian acceptance always minted a fresh player profile, so inviting the same
 * child to a second team produced two people who happened to share a name. There
 * was no way to say "this invitation is for a child I already manage".
 *
 * Acceptance can now name an existing managed profile. The caller must already
 * manage it — this is an explicit selection, never a match on name or birthday
 * (D6).
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  createManagedProfile,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

async function createPlayerInvitation(opts: {
  teamId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  birthday?: string;
}) {
  const id = crypto.randomUUID();
  const { error } = await adminClient.from("invitations").insert({
    id,
    team_id: opts.teamId,
    email: opts.email,
    role: "player",
    first_name: opts.firstName ?? "Zoey",
    last_name: opts.lastName ?? "Butler",
    birthday: opts.birthday ?? null,
  });
  if (error) throw new Error(error.message);
  return id;
}

function acceptAsGuardian(
  invitationId: string,
  guardian: TestUser,
  extra: Record<string, unknown> = {}
) {
  return adminClient.rpc("accept_invitation", {
    p_invitation_id: invitationId,
    p_user_id: guardian.user.id,
    p_mode: "guardian",
    p_relationship: "dad",
    ...extra,
  });
}

async function membershipsOf(profileId: string) {
  const { data } = await adminClient
    .from("team_members")
    .select("team_id, role")
    .eq("profile_id", profileId);
  return data ?? [];
}

async function managedBy(guardianId: string) {
  const { data } = await adminClient
    .from("profile_managers")
    .select("managed_id")
    .eq("manager_id", guardianId)
    .neq("managed_id", guardianId);
  return (data ?? []).map((row) => row.managed_id);
}

describe("accepting a player invitation for a child you already manage (BUG-011)", () => {
  it("adds a membership to the existing child instead of creating a second identity", async () => {
    const coach = await createTestUser();
    const guardian = await createTestUser();
    const { teamId: firstTeam } = await createTestTeam(coach.user.id);
    const { teamId: secondTeam } = await createTestTeam(coach.user.id);

    // The child already exists, on their first team.
    const childId = await createManagedProfile(guardian.user.id, {
      firstName: "Zoey",
      lastName: "Butler",
      relationship: "dad",
    });
    await adminClient
      .from("team_members")
      .insert({ team_id: firstTeam, profile_id: childId, role: "player" });

    const invitationId = await createPlayerInvitation({
      teamId: secondTeam,
      email: guardian.user.email!,
    });

    const { data, error } = await acceptAsGuardian(invitationId, guardian, {
      p_managed_profile_id: childId,
    });
    expect(error).toBeNull();
    expect((data as { managed_profile_id: string }).managed_profile_id).toBe(childId);

    expect(await managedBy(guardian.user.id)).toEqual([childId]);
    const memberships = await membershipsOf(childId);
    expect(memberships.map((m) => m.team_id).sort()).toEqual([firstTeam, secondTeam].sort());
  });

  it("fills in details the child did not have, and leaves the ones they did", async () => {
    const coach = await createTestUser();
    const guardian = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const childId = await createManagedProfile(guardian.user.id, { firstName: "Zoey" });

    const invitationId = await createPlayerInvitation({
      teamId,
      email: guardian.user.email!,
      firstName: "Zoe",
      birthday: "2016-04-02",
    });

    await acceptAsGuardian(invitationId, guardian, { p_managed_profile_id: childId });

    const { data: child } = await adminClient
      .from("profiles")
      .select("first_name, birthday")
      .eq("id", childId)
      .single();
    // The invitation knows their birthday; the roster name the guardian already
    // uses is not overwritten by the coach's spelling.
    expect(child!.birthday).toBe("2016-04-02");
    expect(child!.first_name).toBe("Zoey");
  });

  it("refuses a profile the caller does not manage, and changes nothing", async () => {
    const coach = await createTestUser();
    const guardian = await createTestUser();
    const stranger = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const someoneElsesChild = await createManagedProfile(stranger.user.id);

    const invitationId = await createPlayerInvitation({
      teamId,
      email: guardian.user.email!,
    });

    const { error } = await acceptAsGuardian(invitationId, guardian, {
      p_managed_profile_id: someoneElsesChild,
    });
    expect(error).not.toBeNull();

    expect(await membershipsOf(someoneElsesChild)).toHaveLength(0);
    expect(await managedBy(guardian.user.id)).toHaveLength(0);
    const { data: invitation } = await adminClient
      .from("invitations")
      .select("accepted_at")
      .eq("id", invitationId)
      .single();
    expect(invitation!.accepted_at).toBeNull();
  });

  it("still creates a new player when the guardian names no existing child", async () => {
    const coach = await createTestUser();
    const guardian = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const invitationId = await createPlayerInvitation({
      teamId,
      email: guardian.user.email!,
      firstName: "Robin",
    });

    const { data, error } = await acceptAsGuardian(invitationId, guardian);
    expect(error).toBeNull();

    const childId = (data as { managed_profile_id: string }).managed_profile_id;
    expect(await managedBy(guardian.user.id)).toEqual([childId]);
    const { data: child } = await adminClient
      .from("profiles")
      .select("first_name, auth_user_id")
      .eq("id", childId)
      .single();
    expect(child!.first_name).toBe("Robin");
    expect(child!.auth_user_id).toBeNull();
  });

  it("is harmless if the child is already on that team", async () => {
    const coach = await createTestUser();
    const guardian = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const childId = await createManagedProfile(guardian.user.id);
    await adminClient
      .from("team_members")
      .insert({ team_id: teamId, profile_id: childId, role: "player" });

    const invitationId = await createPlayerInvitation({
      teamId,
      email: guardian.user.email!,
    });

    const { error } = await acceptAsGuardian(invitationId, guardian, {
      p_managed_profile_id: childId,
    });
    expect(error).toBeNull();

    expect(await membershipsOf(childId)).toHaveLength(1);
  });

  it("ignores a named child when the invitation is accepted as the player themselves", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const unrelatedChild = await createManagedProfile(player.user.id);

    const invitationId = await createPlayerInvitation({
      teamId,
      email: player.user.email!,
    });

    const { error } = await adminClient.rpc("accept_invitation", {
      p_invitation_id: invitationId,
      p_user_id: player.user.id,
      p_mode: "self",
      p_managed_profile_id: unrelatedChild,
    });
    expect(error).toBeNull();

    // The signed-in person joined; the child they manage was not touched.
    expect((await membershipsOf(player.user.id)).map((m) => m.team_id)).toEqual([teamId]);
    expect(await membershipsOf(unrelatedChild)).toHaveLength(0);
  });
});
