import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
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
