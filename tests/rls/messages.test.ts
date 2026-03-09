import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  createManagedProfile,
  cleanupTestData,
  adminClient,
} from "./helpers";

describe("messages RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  async function getTeamChannel(teamId: string) {
    const { data } = await adminClient
      .from("channels")
      .select("id")
      .eq("team_id", teamId)
      .eq("type", "team")
      .single();
    if (!data) throw new Error(`No team channel for team ${teamId}`);
    return data.id;
  }

  // ─── Team channel messages ───────────────────────────────────────────────

  it("team member can INSERT a message to the team channel", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const channelId = await getTeamChannel(teamId);

    const { error } = await coach.client.from("messages").insert({
      id: crypto.randomUUID(),
      channel_id: channelId,
      sender_id: coach.user.id,
      body: "Hello team!",
    });

    expect(error).toBeNull();
  });

  it("team member can SELECT messages in the team channel", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    const channelId = await getTeamChannel(teamId);

    await adminClient.from("messages").insert({
      channel_id: channelId,
      sender_id: coach.user.id,
      body: "Practice at 6pm",
    });

    const { data, error } = await player.client
      .from("messages")
      .select()
      .eq("channel_id", channelId);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("non-member cannot INSERT to the team channel", async () => {
    const coach = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const channelId = await getTeamChannel(teamId);

    const { error } = await outsider.client.from("messages").insert({
      channel_id: channelId,
      sender_id: outsider.user.id,
      body: "I'm not on this team",
    });

    expect(error).not.toBeNull();
  });

  it("non-member cannot SELECT messages from the team channel", async () => {
    const coach = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const channelId = await getTeamChannel(teamId);

    await adminClient.from("messages").insert({
      channel_id: channelId,
      sender_id: coach.user.id,
      body: "Secret team message",
    });

    const { data, error } = await outsider.client
      .from("messages")
      .select()
      .eq("channel_id", channelId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("cannot INSERT a message with a different sender_id (spoofing)", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    const channelId = await getTeamChannel(teamId);

    // Player tries to send a message as the coach
    const { error } = await player.client.from("messages").insert({
      channel_id: channelId,
      sender_id: coach.user.id,
      body: "Pretending to be coach",
    });

    expect(error).not.toBeNull();
  });

  // ─── Viewing As: parent sends as themselves (Option A) ───────────────────

  it("parent managing a team member can INSERT to that team's channel as themselves", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    // Create managed child on the team; parent is NOT a direct team member
    const childId = await createManagedProfile(parent.user.id, { relationship: "Parent" });
    await addTeamMember(teamId, childId, "player");

    const channelId = await getTeamChannel(teamId);

    // Parent sends as their own profile (Option A)
    const { error } = await parent.client.from("messages").insert({
      channel_id: channelId,
      sender_id: parent.user.id,
      body: "My kid will be late",
    });

    expect(error).toBeNull();
  });

  it("parent can SELECT messages from their child's team channel", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const childId = await createManagedProfile(parent.user.id, { relationship: "Parent" });
    await addTeamMember(teamId, childId, "player");

    const channelId = await getTeamChannel(teamId);
    await adminClient.from("messages").insert({
      channel_id: channelId,
      sender_id: coach.user.id,
      body: "Game day info",
    });

    const { data, error } = await parent.client
      .from("messages")
      .select()
      .eq("channel_id", channelId);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  // ─── Soft delete ─────────────────────────────────────────────────────────

  it("sender can soft-delete their own message", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const channelId = await getTeamChannel(teamId);

    const msgId = crypto.randomUUID();
    await adminClient.from("messages").insert({
      id: msgId,
      channel_id: channelId,
      sender_id: coach.user.id,
      body: "Oops wrong channel",
    });

    const { error } = await coach.client
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", msgId);

    expect(error).toBeNull();

    const { data } = await adminClient
      .from("messages")
      .select()
      .eq("id", msgId);
    expect(data![0].deleted_at).not.toBeNull();
  });

  it("admin can soft-delete any message", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    const channelId = await getTeamChannel(teamId);

    const msgId = crypto.randomUUID();
    await adminClient.from("messages").insert({
      id: msgId,
      channel_id: channelId,
      sender_id: player.user.id,
      body: "Inappropriate message",
    });

    // Coach (admin) soft-deletes player's message
    const { error } = await coach.client
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", msgId);

    expect(error).toBeNull();

    const { data } = await adminClient.from("messages").select().eq("id", msgId);
    expect(data![0].deleted_at).not.toBeNull();
  });

  it("non-sender non-admin cannot soft-delete a message", async () => {
    const coach = await createTestUser();
    const player1 = await createTestUser();
    const player2 = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player1.user.id, "player");
    await addTeamMember(teamId, player2.user.id, "player");
    const channelId = await getTeamChannel(teamId);

    const msgId = crypto.randomUUID();
    await adminClient.from("messages").insert({
      id: msgId,
      channel_id: channelId,
      sender_id: player1.user.id,
      body: "Player 1 message",
    });

    // Player 2 tries to delete player 1's message
    await player2.client
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", msgId);

    // Verify still not deleted
    const { data } = await adminClient.from("messages").select().eq("id", msgId);
    expect(data![0].deleted_at).toBeNull();
  });

  // ─── Group channel messages ───────────────────────────────────────────────

  it("group channel member can INSERT and SELECT messages", async () => {
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

    const { error: insertError } = await player.client.from("messages").insert({
      channel_id: channelId,
      sender_id: player.user.id,
      body: "Goalie talk",
    });
    expect(insertError).toBeNull();

    const { data, error: selectError } = await player.client
      .from("messages")
      .select()
      .eq("channel_id", channelId);
    expect(selectError).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("non-member of group channel cannot INSERT or SELECT messages", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    await addTeamMember(teamId, outsider.user.id, "player");

    const channelId = crypto.randomUUID();
    await adminClient.from("channels").insert({
      id: channelId,
      team_id: teamId,
      name: "Coaches Secret",
      type: "group",
      created_by: coach.user.id,
    });
    await adminClient.from("channel_members").insert({
      channel_id: channelId,
      profile_id: coach.user.id,
    });
    await adminClient.from("messages").insert({
      channel_id: channelId,
      sender_id: coach.user.id,
      body: "Secret message",
    });

    const { error: insertError } = await outsider.client.from("messages").insert({
      channel_id: channelId,
      sender_id: outsider.user.id,
      body: "Sneaking in",
    });
    expect(insertError).not.toBeNull();

    const { data } = await outsider.client
      .from("messages")
      .select()
      .eq("channel_id", channelId);
    expect(data).toHaveLength(0);
  });

  // ─── DM messages ─────────────────────────────────────────────────────────

  it("DM participants can INSERT and SELECT messages", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    // Create DM channel (sort profile_a < profile_b)
    const [profileA, profileB] = [coach.user.id, player.user.id].sort();
    const dmId = crypto.randomUUID();
    await adminClient.from("dm_channels").insert({
      id: dmId,
      team_id: teamId,
      profile_a: profileA,
      profile_b: profileB,
    });

    const { error } = await coach.client.from("messages").insert({
      dm_channel_id: dmId,
      sender_id: coach.user.id,
      body: "Hey, great game!",
    });
    expect(error).toBeNull();

    const { data, error: selectError } = await player.client
      .from("messages")
      .select()
      .eq("dm_channel_id", dmId);
    expect(selectError).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("third party cannot SELECT DM messages", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const spy = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");
    await addTeamMember(teamId, spy.user.id, "player");

    const [profileA, profileB] = [coach.user.id, player.user.id].sort();
    const dmId = crypto.randomUUID();
    await adminClient.from("dm_channels").insert({
      id: dmId,
      team_id: teamId,
      profile_a: profileA,
      profile_b: profileB,
    });
    await adminClient.from("messages").insert({
      dm_channel_id: dmId,
      sender_id: coach.user.id,
      body: "Private message",
    });

    const { data } = await spy.client
      .from("messages")
      .select()
      .eq("dm_channel_id", dmId);
    expect(data).toHaveLength(0);
  });
});
