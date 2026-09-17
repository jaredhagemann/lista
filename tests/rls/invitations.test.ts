import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  createManagedProfile,
  rawSql,
  cleanupTestData,
  adminClient,
} from "./helpers";

describe("invitations RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("admin can INSERT invitations", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const { error } = await coach.client.from("invitations").insert({
      team_id: teamId,
      email: "newplayer@test.local",
      role: "player",
      invited_by: coach.user.id,
    });
    expect(error).toBeNull();
  });

  it("non-admin cannot INSERT invitations", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    // Player is not a team member at all, should fail
    const { error } = await player.client.from("invitations").insert({
      team_id: teamId,
      email: "someone@test.local",
      role: "player",
    });
    expect(error).not.toBeNull();
  });

  it("admin can SELECT invitations", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    await adminClient.from("invitations").insert({
      team_id: teamId,
      email: "invitee@test.local",
      role: "player",
      invited_by: coach.user.id,
    });

    const { data, error } = await coach.client
      .from("invitations")
      .select()
      .eq("team_id", teamId);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it("admin can UPDATE invitations", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const invId = crypto.randomUUID();
    await adminClient.from("invitations").insert({
      id: invId,
      team_id: teamId,
      email: "someone@test.local",
      role: "player",
    });

    const { error } = await coach.client
      .from("invitations")
      .update({ role: "manager" })
      .eq("id", invId);
    expect(error).toBeNull();
  });

  it("manager can INSERT invitations", async () => {
    const coach = await createTestUser();
    const manager = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, manager.user.id, "manager");

    const { error } = await manager.client.from("invitations").insert({
      team_id: teamId,
      email: "recruit@test.local",
      role: "player",
      invited_by: manager.user.id,
    });
    expect(error).toBeNull();
  });

  it("player team member cannot INSERT invitations", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await player.client.from("invitations").insert({
      team_id: teamId,
      email: "friend@test.local",
      role: "player",
      invited_by: player.user.id,
    });
    expect(error).not.toBeNull();
  });

  it("second player team member cannot INSERT invitations", async () => {
    const coach = await createTestUser();
    const player2 = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player2.user.id, "player");

    const { error } = await player2.client.from("invitations").insert({
      team_id: teamId,
      email: "another@test.local",
      role: "player",
      invited_by: player2.user.id,
    });
    expect(error).not.toBeNull();
  });

  it("player team member cannot UPDATE invitations", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const invId = crypto.randomUUID();
    await adminClient.from("invitations").insert({
      id: invId,
      team_id: teamId,
      email: "target@test.local",
      role: "player",
    });

    await player.client
      .from("invitations")
      .update({ role: "manager" })
      .eq("id", invId);
    // RLS blocks the update — verify role unchanged
    const { data } = await adminClient
      .from("invitations")
      .select()
      .eq("id", invId);
    expect(data![0].role).toBe("player");
  });

  it("player team member cannot DELETE invitations", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const invId = crypto.randomUUID();
    await adminClient.from("invitations").insert({
      id: invId,
      team_id: teamId,
      email: "nodelete@test.local",
      role: "player",
    });

    await player.client.from("invitations").delete().eq("id", invId);
    // Verify invitation still exists
    const { data } = await adminClient
      .from("invitations")
      .select()
      .eq("id", invId);
    expect(data!.length).toBe(1);
  });

  it("invited user can view own invitation", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const invitedEmail = `invited-${crypto.randomUUID()}@test.local`;
    const invitee = await createTestUser(invitedEmail);

    await adminClient.from("invitations").insert({
      team_id: teamId,
      email: invitedEmail,
      role: "player",
    });

    const { data, error } = await invitee.client
      .from("invitations")
      .select()
      .eq("email", invitedEmail);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  // Regression tests for the removed `accepted_at is null` broad-select clause.
  // Before the migration, any authenticated user could read all pending
  // invitations across all teams. These cases must return 0 rows.

  it("player team member cannot read pending invitations for their own team", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    await adminClient.from("invitations").insert({
      team_id: teamId,
      email: "pending@test.local",
      role: "player",
      invited_by: coach.user.id,
    });

    const { data, error } = await player.client
      .from("invitations")
      .select()
      .eq("team_id", teamId)
      .is("accepted_at", null);
    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });

  it("authenticated user cannot read pending invitations for a team they don't belong to", async () => {
    const coach = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    await adminClient.from("invitations").insert({
      team_id: teamId,
      email: "someone@test.local",
      role: "player",
      invited_by: coach.user.id,
    });

    const { data, error } = await outsider.client
      .from("invitations")
      .select()
      .eq("team_id", teamId)
      .is("accepted_at", null);
    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });

  it("admin cannot read pending invitations for another team", async () => {
    const coachA = await createTestUser();
    const coachB = await createTestUser();
    const { teamId: teamA } = await createTestTeam(coachA.user.id);
    const { teamId: teamB } = await createTestTeam(coachB.user.id);

    await adminClient.from("invitations").insert({
      team_id: teamB,
      email: "teamb-player@test.local",
      role: "player",
      invited_by: coachB.user.id,
    });

    const { data, error } = await coachA.client
      .from("invitations")
      .select()
      .eq("team_id", teamB)
      .is("accepted_at", null);
    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });
});

// ── BUG-002 ───────────────────────────────────────────────────────────────────
// A guardian invitation (managed_profile_id set) grants guardianship of that
// player on acceptance. Per D1 it may come from the player, an existing
// guardian, or staff of a team the player is on. Anyone can create a team, so
// "staff of any team" was a claim path.

describe("invitations RLS: guardian invitations (BUG-002)", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("coach of an unrelated team cannot invite a guardian for a player not on that team", async () => {
    const realCoach = await createTestUser();
    const parent = await createTestUser();
    const attacker = await createTestUser();
    const { teamId: realTeamId } = await createTestTeam(realCoach.user.id);
    const { teamId: attackerTeamId } = await createTestTeam(attacker.user.id);
    const childId = await createManagedProfile(parent.user.id);
    await addTeamMember(realTeamId, childId, "player");

    const { error } = await attacker.client.from("invitations").insert({
      team_id: attackerTeamId,
      email: "attacker@test.local",
      role: "manager",
      managed_profile_id: childId,
      invited_by: attacker.user.id,
    });
    expect(error).not.toBeNull();
  });

  it("coach can invite a guardian for a player on their team", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const childId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, childId, "player");

    const { error } = await coach.client.from("invitations").insert({
      team_id: teamId,
      email: "grandparent@test.local",
      role: "manager",
      managed_profile_id: childId,
      invited_by: coach.user.id,
    });
    expect(error).toBeNull();
  });

  it("existing guardian can invite another guardian for their child", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const childId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, childId, "player");

    const { error } = await parent.client.from("invitations").insert({
      team_id: teamId,
      email: "coparent@test.local",
      role: "manager",
      managed_profile_id: childId,
      invited_by: parent.user.id,
    });
    expect(error).toBeNull();
  });

  it("player with their own login can invite a guardian for themselves", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await player.client.from("invitations").insert({
      team_id: teamId,
      email: "mom@test.local",
      role: "manager",
      managed_profile_id: player.user.id,
      invited_by: player.user.id,
    });
    expect(error).toBeNull();
  });

  it("coach cannot re-point an existing invitation at a player not on their team", async () => {
    const coach = await createTestUser();
    const otherParent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const outsideChildId = await createManagedProfile(otherParent.user.id);
    const inviteId = crypto.randomUUID();
    await adminClient.from("invitations").insert({
      id: inviteId,
      team_id: teamId,
      email: "plain@test.local",
      role: "player",
    });

    await coach.client
      .from("invitations")
      .update({ managed_profile_id: outsideChildId, role: "manager" })
      .eq("id", inviteId);

    const { data } = await adminClient
      .from("invitations")
      .select("managed_profile_id")
      .eq("id", inviteId)
      .single();
    expect(data!.managed_profile_id).toBeNull();
  });
});

// ── BUG-012 ───────────────────────────────────────────────────────────────────
// A guardian invitation grants guardianship only. Its role is always "manager"
// (the string the web and mobile clients send), so it can never carry a team
// role such as coach. Checked at creation, on every path.

describe("invitations: guardian invitations cannot carry a team role (BUG-012)", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("guardian cannot create a guardian invitation with role coach", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const childId = await createManagedProfile(parent.user.id);

    const { error } = await parent.client.from("invitations").insert({
      team_id: teamId,
      email: parent.user.email,
      role: "coach",
      managed_profile_id: childId,
      invited_by: parent.user.id,
    });
    expect(error).not.toBeNull();
  });

  it("the service role cannot create one either", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const childId = await createManagedProfile(parent.user.id);

    const { error } = await adminClient.from("invitations").insert({
      team_id: teamId,
      email: "someone@test.local",
      role: "player",
      managed_profile_id: childId,
    });
    expect(error).not.toBeNull();
  });
});

// ── BUG-002 review, finding 3 ─────────────────────────────────────────────────
// A player's authority to invite their own guardian comes from owning the
// profile (their login), not from the optional Self link.

describe("invitations: player authority does not depend on a Self link (BUG-002 review, finding 3)", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("player with a login but no Self link can still invite a guardian for themselves", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    // Simulate an account whose Self link was removed before it became
    // undeletable: bypass triggers for this fixture only.
    rawSql(
      `set session_replication_role = replica; delete from profile_managers where manager_id = '${player.user.id}' and managed_id = '${player.user.id}';`
    );

    const { error } = await player.client.from("invitations").insert({
      team_id: teamId,
      email: "mom@test.local",
      role: "manager",
      managed_profile_id: player.user.id,
      invited_by: player.user.id,
    });
    expect(error).toBeNull();
  });
});
