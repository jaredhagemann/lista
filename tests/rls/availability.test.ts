import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  cleanupTestData,
  adminClient,
} from "./helpers";

describe("availability RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  async function createEvent(teamId: string) {
    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Practice",
      event_type: "practice",
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 3600_000).toISOString(),
    });
    return eventId;
  }

  it("team member can SELECT availability", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const eventId = await createEvent(teamId);
    await adminClient.from("availability").insert({
      event_id: eventId,
      profile_id: player.user.id,
      status: "available",
    });

    const { data, error } = await coach.client
      .from("availability")
      .select()
      .eq("event_id", eventId);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it("user can INSERT own availability", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const eventId = await createEvent(teamId);

    const { error } = await player.client.from("availability").insert({
      event_id: eventId,
      profile_id: player.user.id,
      status: "available",
    });
    expect(error).toBeNull();
  });

  it("user cannot INSERT availability for others", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const eventId = await createEvent(teamId);

    const { error } = await coach.client.from("availability").insert({
      event_id: eventId,
      profile_id: player.user.id,
      status: "unavailable",
    });
    expect(error).not.toBeNull();
  });

  it("user can UPDATE own availability", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const eventId = await createEvent(teamId);
    await adminClient.from("availability").insert({
      event_id: eventId,
      profile_id: player.user.id,
      status: "available",
    });

    const { error } = await player.client
      .from("availability")
      .update({ status: "unavailable" })
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);
    expect(error).toBeNull();
  });

  it("user cannot UPDATE others' availability", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const eventId = await createEvent(teamId);
    await adminClient.from("availability").insert({
      event_id: eventId,
      profile_id: player.user.id,
      status: "available",
    });

    await coach.client
      .from("availability")
      .update({ status: "unavailable" })
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);

    // Verify unchanged
    const { data } = await adminClient
      .from("availability")
      .select()
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);
    expect(data![0].status).toBe("available");
  });

  // ── Delete policies ────────────────────────────────────────────────────────

  it("user can DELETE own availability", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const eventId = await createEvent(teamId);
    await adminClient.from("availability").insert({
      event_id: eventId,
      profile_id: player.user.id,
      status: "available",
    });

    const { error } = await player.client
      .from("availability")
      .delete()
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);
    expect(error).toBeNull();

    const { data } = await adminClient
      .from("availability")
      .select()
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);
    expect(data!.length).toBe(0);
  });

  it("user cannot DELETE others' availability", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const eventId = await createEvent(teamId);
    await adminClient.from("availability").insert({
      event_id: eventId,
      profile_id: player.user.id,
      status: "available",
    });

    // player2 (the coach here, without admin role in policy sense) attempts delete
    const player2 = await createTestUser();
    await addTeamMember(teamId, player2.user.id, "player");

    await player2.client
      .from("availability")
      .delete()
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);

    const { data } = await adminClient
      .from("availability")
      .select()
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);
    expect(data!.length).toBe(1);
  });

  // ── Admin override policies ────────────────────────────────────────────────

  it("admin (coach) can INSERT availability for any member", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const eventId = await createEvent(teamId);

    const { error } = await coach.client.from("availability").insert({
      event_id: eventId,
      profile_id: player.user.id,
      status: "available",
    });
    expect(error).toBeNull();
  });

  it("admin (coach) can UPDATE any member's availability", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const eventId = await createEvent(teamId);
    await adminClient.from("availability").insert({
      event_id: eventId,
      profile_id: player.user.id,
      status: "available",
    });

    const { error } = await coach.client
      .from("availability")
      .update({ status: "maybe" })
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);
    expect(error).toBeNull();

    const { data } = await adminClient
      .from("availability")
      .select()
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);
    expect(data![0].status).toBe("maybe");
  });

  it("admin (coach) can DELETE any member's availability", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const eventId = await createEvent(teamId);
    await adminClient.from("availability").insert({
      event_id: eventId,
      profile_id: player.user.id,
      status: "unavailable",
    });

    const { error } = await coach.client
      .from("availability")
      .delete()
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);
    expect(error).toBeNull();

    const { data } = await adminClient
      .from("availability")
      .select()
      .eq("event_id", eventId)
      .eq("profile_id", player.user.id);
    expect(data!.length).toBe(0);
  });
});
