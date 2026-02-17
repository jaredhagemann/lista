import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  cleanupTestData,
  adminClient,
} from "./helpers";

describe("team_members RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("team member can SELECT team members", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { data, error } = await coach.client
      .from("team_members")
      .select()
      .eq("team_id", teamId);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });

  it("non-member cannot SELECT team members", async () => {
    const coach = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const { data, error } = await outsider.client
      .from("team_members")
      .select()
      .eq("team_id", teamId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("admin can INSERT team members", async () => {
    const coach = await createTestUser();
    const newPlayer = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const { error } = await coach.client
      .from("team_members")
      .insert({ team_id: teamId, profile_id: newPlayer.user.id, role: "player" });
    expect(error).toBeNull();
  });

  it("user can self-insert as team member", async () => {
    const coach = await createTestUser();
    const joiner = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const { error } = await joiner.client
      .from("team_members")
      .insert({ team_id: teamId, profile_id: joiner.user.id, role: "player" });
    expect(error).toBeNull();
  });

  it("non-admin cannot INSERT other members", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const otherUser = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await player.client
      .from("team_members")
      .insert({ team_id: teamId, profile_id: otherUser.user.id, role: "player" });
    expect(error).not.toBeNull();
  });

  it("admin can UPDATE team members", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await coach.client
      .from("team_members")
      .update({ role: "manager" })
      .eq("team_id", teamId)
      .eq("profile_id", player.user.id);
    expect(error).toBeNull();
  });

  it("non-admin cannot UPDATE team members", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await player.client
      .from("team_members")
      .update({ role: "coach" })
      .eq("team_id", teamId)
      .eq("profile_id", player.user.id);
    // RLS blocks — verify unchanged
    const { data } = await adminClient
      .from("team_members")
      .select()
      .eq("team_id", teamId)
      .eq("profile_id", player.user.id);
    expect(data![0].role).toBe("player");
  });

  it("admin can DELETE team members", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await coach.client
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("profile_id", player.user.id);
    expect(error).toBeNull();

    const { data } = await adminClient
      .from("team_members")
      .select()
      .eq("team_id", teamId)
      .eq("profile_id", player.user.id);
    expect(data).toHaveLength(0);
  });
});
