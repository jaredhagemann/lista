import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  createManagedProfile,
  cleanupTestData,
  adminClient,
} from "./helpers";

describe("channels RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("team member can SELECT the team channel", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const { data, error } = await coach.client
      .from("channels")
      .select()
      .eq("team_id", teamId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].type).toBe("team");
    expect(data![0].name).toBe("Team Chat");
  });

  it("non-member cannot SELECT team channels", async () => {
    const coach = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const { data, error } = await outsider.client
      .from("channels")
      .select()
      .eq("team_id", teamId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("manager of a team member can SELECT the team channel", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    // Create a managed player and add them to the team
    const childId = await createManagedProfile(parent.user.id, { relationship: "Parent" });
    await addTeamMember(teamId, childId, "player");

    const { data, error } = await parent.client
      .from("channels")
      .select()
      .eq("team_id", teamId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("team member can INSERT a group channel", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const channelId = crypto.randomUUID();
    const { error } = await coach.client.from("channels").insert({
      id: channelId,
      team_id: teamId,
      name: "Coaches",
      type: "group",
      created_by: coach.user.id,
    });

    expect(error).toBeNull();
  });

  it("non-member cannot INSERT a group channel", async () => {
    const coach = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const { error } = await outsider.client.from("channels").insert({
      team_id: teamId,
      name: "Sneaky Group",
      type: "group",
      created_by: outsider.user.id,
    });

    expect(error).not.toBeNull();
  });

  it("cannot INSERT a team-type channel (trigger-only)", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const { error } = await coach.client.from("channels").insert({
      team_id: teamId,
      name: "Fake Team Chat",
      type: "team",
    });

    expect(error).not.toBeNull();
  });

  it("creator can DELETE a group channel", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const channelId = crypto.randomUUID();
    await adminClient.from("channels").insert({
      id: channelId,
      team_id: teamId,
      name: "To Delete",
      type: "group",
      created_by: coach.user.id,
    });

    const { error } = await coach.client
      .from("channels")
      .delete()
      .eq("id", channelId);

    expect(error).toBeNull();
  });

  it("non-creator non-admin cannot DELETE a group channel", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const channelId = crypto.randomUUID();
    await adminClient.from("channels").insert({
      id: channelId,
      team_id: teamId,
      name: "Coach Only",
      type: "group",
      created_by: coach.user.id,
    });

    await player.client
      .from("channels")
      .delete()
      .eq("id", channelId);

    // RLS blocks the delete (no error returned, but 0 rows affected)
    // Verify channel still exists
    const { data } = await adminClient.from("channels").select().eq("id", channelId);
    expect(data).toHaveLength(1);
  });

  it("admin can DELETE any group channel", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const channelId = crypto.randomUUID();
    await adminClient.from("channels").insert({
      id: channelId,
      team_id: teamId,
      name: "Player Group",
      type: "group",
      created_by: player.user.id,
    });

    // Coach (admin) deletes player's group
    const { error } = await coach.client
      .from("channels")
      .delete()
      .eq("id", channelId);

    expect(error).toBeNull();
  });

  it("non-member cannot see group channels they are not in", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    // Coach creates a group channel and does NOT add the player
    const channelId = crypto.randomUUID();
    await adminClient.from("channels").insert({
      id: channelId,
      team_id: teamId,
      name: "Coaches Only",
      type: "group",
      created_by: coach.user.id,
    });
    // Add coach to channel_members so is_channel_member returns true for coach
    await adminClient.from("channel_members").insert({
      channel_id: channelId,
      profile_id: coach.user.id,
    });

    const { data } = await player.client
      .from("channels")
      .select()
      .eq("id", channelId);

    expect(data).toHaveLength(0);
  });

  it("group channel member can see their channel", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const channelId = crypto.randomUUID();
    await adminClient.from("channels").insert({
      id: channelId,
      team_id: teamId,
      name: "Goalies",
      type: "group",
      created_by: coach.user.id,
    });
    await adminClient.from("channel_members").insert([
      { channel_id: channelId, profile_id: coach.user.id },
      { channel_id: channelId, profile_id: player.user.id },
    ]);

    const { data, error } = await player.client
      .from("channels")
      .select()
      .eq("id", channelId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});
