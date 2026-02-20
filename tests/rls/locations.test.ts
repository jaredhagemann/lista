import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  cleanupTestData,
  adminClient,
} from "./helpers";

describe("locations RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("team member can SELECT locations", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const locationId = crypto.randomUUID();
    await adminClient.from("locations").insert({
      id: locationId,
      team_id: teamId,
      name: "Main Field",
    });

    const { data, error } = await player.client
      .from("locations")
      .select()
      .eq("id", locationId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("non-member cannot SELECT locations", async () => {
    const coach = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const locationId = crypto.randomUUID();
    await adminClient.from("locations").insert({
      id: locationId,
      team_id: teamId,
      name: "Secret Field",
    });

    const { data, error } = await outsider.client
      .from("locations")
      .select()
      .eq("id", locationId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("admin can INSERT locations", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const { error } = await coach.client.from("locations").insert({
      team_id: teamId,
      name: "Practice Field",
    });
    expect(error).toBeNull();
  });

  it("non-admin cannot INSERT locations", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await player.client.from("locations").insert({
      team_id: teamId,
      name: "Rogue Field",
    });
    expect(error).not.toBeNull();
  });

  it("admin can UPDATE locations", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const locationId = crypto.randomUUID();
    await adminClient.from("locations").insert({
      id: locationId,
      team_id: teamId,
      name: "Old Name",
    });

    const { error } = await coach.client
      .from("locations")
      .update({ name: "New Name" })
      .eq("id", locationId);
    expect(error).toBeNull();
  });

  it("admin can DELETE locations", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const locationId = crypto.randomUUID();
    await adminClient.from("locations").insert({
      id: locationId,
      team_id: teamId,
      name: "To Delete",
    });

    const { error } = await coach.client
      .from("locations")
      .delete()
      .eq("id", locationId);
    expect(error).toBeNull();

    const { data } = await adminClient
      .from("locations")
      .select()
      .eq("id", locationId);
    expect(data).toHaveLength(0);
  });

  it("non-admin cannot modify locations", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const locationId = crypto.randomUUID();
    await adminClient.from("locations").insert({
      id: locationId,
      team_id: teamId,
      name: "Untouchable",
    });

    // UPDATE should be blocked
    await player.client
      .from("locations")
      .update({ name: "Hacked" })
      .eq("id", locationId);

    const { data } = await adminClient
      .from("locations")
      .select()
      .eq("id", locationId);
    expect(data![0].name).toBe("Untouchable");
  });
});
