import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  createManagedProfile,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

describe("profile_managers RLS", () => {
  it("manager can view their own managed profiles", async () => {
    const parent = await createTestUser();
    const managedId = await createManagedProfile(parent.user.id);

    const { data, error } = await parent.client
      .from("profile_managers")
      .select("*")
      .eq("managed_id", managedId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].managed_id).toBe(managedId);
  });

  it("user cannot view another user's managed profiles", async () => {
    const parent = await createTestUser();
    const stranger = await createTestUser();
    const managedId = await createManagedProfile(parent.user.id);

    const { data } = await stranger.client
      .from("profile_managers")
      .select("*")
      .eq("managed_id", managedId);

    expect(data).toHaveLength(0);
  });

  it("team admin can view managed profiles for members of their team", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const managedId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, managedId, "player");

    const { data } = await coach.client
      .from("profile_managers")
      .select("*")
      .eq("managed_id", managedId);

    expect(data).toHaveLength(1);
  });
});

describe("managed profiles: profiles RLS", () => {
  it("manager can read their managed profile", async () => {
    const parent = await createTestUser();
    const managedId = await createManagedProfile(parent.user.id);

    const { data, error } = await parent.client
      .from("profiles")
      .select("id, first_name")
      .eq("id", managedId)
      .single();

    expect(error).toBeNull();
    expect(data!.id).toBe(managedId);
  });

  it("stranger cannot read a managed profile they don't manage", async () => {
    const parent = await createTestUser();
    const stranger = await createTestUser();
    const managedId = await createManagedProfile(parent.user.id);

    const { data } = await stranger.client
      .from("profiles")
      .select("id")
      .eq("id", managedId);

    expect(data).toHaveLength(0);
  });

  it("manager can update their managed profile", async () => {
    const parent = await createTestUser();
    const managedId = await createManagedProfile(parent.user.id, { firstName: "Before" });

    const { error } = await parent.client
      .from("profiles")
      .update({ first_name: "After" })
      .eq("id", managedId);

    expect(error).toBeNull();

    const { data } = await adminClient
      .from("profiles")
      .select("first_name")
      .eq("id", managedId)
      .single();
    expect(data!.first_name).toBe("After");
  });

  it("stranger cannot update a managed profile they don't manage", async () => {
    const parent = await createTestUser();
    const stranger = await createTestUser();
    const managedId = await createManagedProfile(parent.user.id);

    const { error } = await stranger.client
      .from("profiles")
      .update({ first_name: "Hacked" })
      .eq("id", managedId);

    // RLS blocks the update — no error, but 0 rows affected
    const { data } = await adminClient
      .from("profiles")
      .select("first_name")
      .eq("id", managedId)
      .single();
    expect(data!.first_name).not.toBe("Hacked");
  });

  it("teammates can see a managed profile on their team", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const managedId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, managedId, "player");

    const { data } = await coach.client
      .from("profiles")
      .select("id")
      .eq("id", managedId);

    expect(data).toHaveLength(1);
  });
});

describe("managed profiles: availability RLS", () => {
  it("manager can insert availability for a managed profile", async () => {
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(parent.user.id);
    const managedId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, managedId, "player");

    // Create an event
    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Test Event",
      event_type: "practice",
      start_time: new Date(Date.now() + 86400000).toISOString(),
      end_time: new Date(Date.now() + 90000000).toISOString(),
      created_by: parent.user.id,
    });

    const { error } = await parent.client.from("availability").insert({
      event_id: eventId,
      profile_id: managedId,
      status: "available",
    });

    expect(error).toBeNull();
  });

  it("non-manager cannot insert availability for someone else's managed profile", async () => {
    const parent = await createTestUser();
    const stranger = await createTestUser();
    const { teamId } = await createTestTeam(parent.user.id);
    await addTeamMember(teamId, stranger.user.id, "player");
    const managedId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, managedId, "player");

    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Test Event 2",
      event_type: "practice",
      start_time: new Date(Date.now() + 86400000).toISOString(),
      end_time: new Date(Date.now() + 90000000).toISOString(),
      created_by: parent.user.id,
    });

    const { error } = await stranger.client.from("availability").insert({
      event_id: eventId,
      profile_id: managedId,
      status: "available",
    });

    expect(error).not.toBeNull();
  });
});

describe("is_team_member extended for managed profiles", () => {
  it("parent can see events on a team their managed profile is on", async () => {
    const parent = await createTestUser();
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const managedId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, managedId, "player");
    // Parent is NOT directly on the team

    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Managed Profile Team Event",
      event_type: "game",
      start_time: new Date(Date.now() + 86400000).toISOString(),
      end_time: new Date(Date.now() + 90000000).toISOString(),
      created_by: coach.user.id,
    });

    const { data } = await parent.client
      .from("events")
      .select("id")
      .eq("id", eventId);

    expect(data).toHaveLength(1);
  });

  it("stranger cannot see events on a team only accessible via managed profiles", async () => {
    const parent = await createTestUser();
    const coach = await createTestUser();
    const stranger = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const managedId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, managedId, "player");

    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Private Team Event",
      event_type: "game",
      start_time: new Date(Date.now() + 86400000).toISOString(),
      end_time: new Date(Date.now() + 90000000).toISOString(),
      created_by: coach.user.id,
    });

    const { data } = await stranger.client
      .from("events")
      .select("id")
      .eq("id", eventId);

    expect(data).toHaveLength(0);
  });
});

describe("team_members: inserting managed profiles", () => {
  it("manager can add their managed profile to a team they are on", async () => {
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(parent.user.id);
    const managedId = await createManagedProfile(parent.user.id);

    const { error } = await parent.client.from("team_members").insert({
      team_id: teamId,
      profile_id: managedId,
      role: "player",
    });

    expect(error).toBeNull();
  });

  it("non-admin cannot add another user's managed profile to a team", async () => {
    const parent = await createTestUser();
    const coach = await createTestUser();
    const stranger = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id); // coach is admin, not stranger
    await addTeamMember(teamId, stranger.user.id, "player"); // stranger is just a player
    const managedId = await createManagedProfile(parent.user.id);

    const { error } = await stranger.client.from("team_members").insert({
      team_id: teamId,
      profile_id: managedId,
      role: "player",
    });

    expect(error).not.toBeNull();
  });
});
