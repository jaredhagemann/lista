import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
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
});
