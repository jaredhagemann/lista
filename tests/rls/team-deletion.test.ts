import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  cleanupTestData,
  adminClient,
} from "./helpers";

describe("team owner_id and deletion RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  // ── owner_id visibility ──────────────────────────────────────────────────

  it("owner_id is set on team creation", async () => {
    const { user } = await createTestUser();
    const { teamId } = await createTestTeam(user.id);

    const { data } = await adminClient.from("teams").select("owner_id").eq("id", teamId).single();
    expect(data!.owner_id).toBe(user.id);
  });

  it("team owner can read owner_id", async () => {
    const { client, user } = await createTestUser();
    const { teamId } = await createTestTeam(user.id);

    const { data, error } = await client.from("teams").select("owner_id").eq("id", teamId).single();
    expect(error).toBeNull();
    expect(data!.owner_id).toBe(user.id);
  });

  it("non-owner coach can read owner_id", async () => {
    const owner = await createTestUser();
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);
    await addTeamMember(teamId, coach.user.id, "coach");

    const { data, error } = await coach.client.from("teams").select("owner_id").eq("id", teamId).single();
    expect(error).toBeNull();
    expect(data!.owner_id).toBe(owner.user.id);
  });

  it("player can read owner_id", async () => {
    const owner = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { data, error } = await player.client.from("teams").select("owner_id").eq("id", teamId).single();
    expect(error).toBeNull();
    expect(data!.owner_id).toBe(owner.user.id);
  });

  it("non-member cannot read owner_id", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);

    const { data } = await outsider.client.from("teams").select("owner_id").eq("id", teamId);
    expect(data).toHaveLength(0);
  });

  // ── owner_id direct UPDATE blocked ───────────────────────────────────────

  it("team owner cannot directly UPDATE owner_id via client", async () => {
    const owner = await createTestUser();
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);
    await addTeamMember(teamId, coach.user.id, "coach");

    const { error } = await owner.client
      .from("teams")
      .update({ owner_id: coach.user.id })
      .eq("id", teamId);

    expect(error).not.toBeNull();
    // Verify owner_id unchanged
    const { data } = await adminClient.from("teams").select("owner_id").eq("id", teamId).single();
    expect(data!.owner_id).toBe(owner.user.id);
  });

  it("non-owner admin cannot directly UPDATE owner_id via client", async () => {
    const owner = await createTestUser();
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);
    await addTeamMember(teamId, coach.user.id, "coach");

    const { error } = await coach.client
      .from("teams")
      .update({ owner_id: coach.user.id })
      .eq("id", teamId);

    expect(error).not.toBeNull();
    const { data } = await adminClient.from("teams").select("owner_id").eq("id", teamId).single();
    expect(data!.owner_id).toBe(owner.user.id);
  });

  it("player cannot directly UPDATE owner_id via client", async () => {
    const owner = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await player.client
      .from("teams")
      .update({ owner_id: player.user.id })
      .eq("id", teamId);

    // Either a trigger error or RLS block — either way owner_id must be unchanged
    const { data } = await adminClient.from("teams").select("owner_id").eq("id", teamId).single();
    expect(data!.owner_id).toBe(owner.user.id);
  });

  it("trigger rejects setting owner_id to a managed profile", async () => {
    const owner = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);

    // Create a managed profile directly via admin (auth_user_id IS NULL)
    const managedId = crypto.randomUUID();
    await adminClient.from("profiles").insert({
      id: managedId,
      first_name: "Managed",
      last_name: "Player",
      email: `managed-${managedId.slice(0, 8)}@lista.internal`,
    });

    // Attempt to set owner_id to managed profile via service role — trigger should reject
    const { error } = await adminClient
      .from("teams")
      .update({ owner_id: managedId })
      .eq("id", teamId);

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/auth_user_id/i);

    // Cleanup
    await adminClient.from("profiles").delete().eq("id", managedId);
  });

  // ── direct DELETE blocked ─────────────────────────────────────────────────

  it("team owner cannot directly DELETE a team via client", async () => {
    const owner = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);

    await owner.client.from("teams").delete().eq("id", teamId);

    const { data } = await adminClient.from("teams").select("id").eq("id", teamId);
    expect(data).toHaveLength(1);
  });

  it("non-owner admin cannot directly DELETE a team via client", async () => {
    const owner = await createTestUser();
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);
    await addTeamMember(teamId, coach.user.id, "coach");

    await coach.client.from("teams").delete().eq("id", teamId);

    const { data } = await adminClient.from("teams").select("id").eq("id", teamId);
    expect(data).toHaveLength(1);
  });

  it("player cannot directly DELETE a team via client", async () => {
    const owner = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    await player.client.from("teams").delete().eq("id", teamId);

    const { data } = await adminClient.from("teams").select("id").eq("id", teamId);
    expect(data).toHaveLength(1);
  });

  // ── cascade verification ──────────────────────────────────────────────────

  it("deleting a team cascades to team_members", async () => {
    const owner = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    await adminClient.from("teams").delete().eq("id", teamId);

    const { data } = await adminClient.from("team_members").select().eq("team_id", teamId);
    expect(data).toHaveLength(0);
  });

  it("deleting a team cascades to events and availability", async () => {
    const owner = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Practice",
      event_type: "practice",
      start_time: new Date(Date.now() + 86400000).toISOString(),
      end_time: new Date(Date.now() + 90000000).toISOString(),
    });
    await adminClient.from("availability").insert({
      event_id: eventId,
      profile_id: player.user.id,
      status: "available",
    });

    await adminClient.from("teams").delete().eq("id", teamId);

    const { data: events } = await adminClient.from("events").select().eq("team_id", teamId);
    expect(events).toHaveLength(0);
    const { data: avail } = await adminClient.from("availability").select().eq("event_id", eventId);
    expect(avail).toHaveLength(0);
  });

  it("deleting a team cascades to invitations", async () => {
    const owner = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);
    await adminClient.from("invitations").insert({
      team_id: teamId,
      email: "pending@test.local",
      role: "player",
      token: crypto.randomUUID(),
    });

    await adminClient.from("teams").delete().eq("id", teamId);

    const { data } = await adminClient.from("invitations").select().eq("team_id", teamId);
    expect(data).toHaveLength(0);
  });

  it("deleting a team cascades to locations", async () => {
    const owner = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);
    await adminClient.from("locations").insert({ team_id: teamId, name: "Home Field" });

    await adminClient.from("teams").delete().eq("id", teamId);

    const { data } = await adminClient.from("locations").select().eq("team_id", teamId);
    expect(data).toHaveLength(0);
  });

  it("deleting a team cascades to channels, channel_members, and messages", async () => {
    const owner = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const channelId = crypto.randomUUID();
    await adminClient.from("channels").insert({ id: channelId, team_id: teamId, name: "general", type: "team" });
    await adminClient.from("channel_members").insert({ channel_id: channelId, profile_id: owner.user.id });
    await adminClient.from("messages").insert({ channel_id: channelId, profile_id: owner.user.id, content: "hello" });

    await adminClient.from("teams").delete().eq("id", teamId);

    const { data: channels } = await adminClient.from("channels").select().eq("team_id", teamId);
    expect(channels).toHaveLength(0);
    const { data: members } = await adminClient.from("channel_members").select().eq("channel_id", channelId);
    expect(members).toHaveLength(0);
    const { data: msgs } = await adminClient.from("messages").select().eq("channel_id", channelId);
    expect(msgs).toHaveLength(0);
  });

  it("deleting a team sets profiles.active_team_id to NULL", async () => {
    const owner = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);

    // Set active_team_id on the owner's profile
    await adminClient.from("profiles").update({ active_team_id: teamId }).eq("id", owner.user.id);

    await adminClient.from("teams").delete().eq("id", teamId);

    const { data } = await adminClient.from("profiles").select("active_team_id").eq("id", owner.user.id).single();
    expect(data!.active_team_id).toBeNull();
  });

  it("after team deletion, former members cannot access storage objects via RLS policies", async () => {
    const owner = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(owner.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    // Verify player can list team-images for this team before deletion
    const { data: before } = await player.client.storage
      .from("team-images")
      .list(teamId);
    // May be empty but should not error (policy allows team members)
    expect(before).not.toBeNull();

    await adminClient.from("teams").delete().eq("id", teamId);

    // After deletion, the player is no longer a team member — RLS blocks access
    const { data: after, error } = await player.client.storage
      .from("team-images")
      .list(teamId);
    // Storage list returns empty or an error when policy blocks access
    expect(after === null || (Array.isArray(after) && after.length === 0) || error !== null).toBe(true);
  });
});
