import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  cleanupTestData,
  adminClient,
} from "./helpers";

describe("events RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("team member can SELECT events", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    // Create event via admin
    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Practice",
      event_type: "practice",
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 3600_000).toISOString(),
    });

    const { data, error } = await player.client
      .from("events")
      .select()
      .eq("id", eventId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("non-member cannot SELECT events", async () => {
    const coach = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Secret Practice",
      event_type: "practice",
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 3600_000).toISOString(),
    });

    const { data, error } = await outsider.client
      .from("events")
      .select()
      .eq("id", eventId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("admin can INSERT events", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const { error } = await coach.client.from("events").insert({
      team_id: teamId,
      title: "Game Day",
      event_type: "game",
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 7200_000).toISOString(),
    });
    expect(error).toBeNull();
  });

  it("non-admin cannot INSERT events", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await player.client.from("events").insert({
      team_id: teamId,
      title: "Rogue Event",
      event_type: "other",
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(error).not.toBeNull();
  });

  it("admin can UPDATE events", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Original",
      event_type: "practice",
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 3600_000).toISOString(),
    });

    const { error } = await coach.client
      .from("events")
      .update({ title: "Updated" })
      .eq("id", eventId);
    expect(error).toBeNull();
  });

  it("admin can DELETE events", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "To Delete",
      event_type: "other",
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 3600_000).toISOString(),
    });

    const { error } = await coach.client
      .from("events")
      .delete()
      .eq("id", eventId);
    expect(error).toBeNull();

    const { data } = await adminClient.from("events").select().eq("id", eventId);
    expect(data).toHaveLength(0);
  });

  it("non-admin cannot modify events", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Untouchable",
      event_type: "practice",
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 3600_000).toISOString(),
    });

    // UPDATE should be blocked
    await player.client
      .from("events")
      .update({ title: "Hacked" })
      .eq("id", eventId);

    const { data } = await adminClient.from("events").select().eq("id", eventId);
    expect(data![0].title).toBe("Untouchable");
  });
});
