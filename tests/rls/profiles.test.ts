import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  cleanupTestData,
} from "./helpers";

describe("profiles RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("user can see own profile", async () => {
    const { client, user } = await createTestUser();

    const { data, error } = await client
      .from("profiles")
      .select()
      .eq("id", user.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("user can see teammate profiles", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { data, error } = await coach.client
      .from("profiles")
      .select()
      .eq("id", player.user.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("user cannot see non-teammate profiles", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    // No shared team

    const { data, error } = await user1.client
      .from("profiles")
      .select()
      .eq("id", user2.user.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("user can update own profile", async () => {
    const { client, user } = await createTestUser();

    const { error } = await client
      .from("profiles")
      .update({ full_name: "Updated Name" })
      .eq("id", user.id);
    expect(error).toBeNull();

    const { data } = await client.from("profiles").select().eq("id", user.id);
    expect(data![0].full_name).toBe("Updated Name");
  });

  it("user cannot update another user's profile", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    // Make them teammates so user1 can see user2
    const { teamId } = await createTestTeam(user1.user.id);
    await addTeamMember(teamId, user2.user.id, "player");

    const { error } = await user1.client
      .from("profiles")
      .update({ full_name: "Hacked" })
      .eq("id", user2.user.id);
    // RLS blocks — no error but no rows updated
    const { data } = await user2.client.from("profiles").select().eq("id", user2.user.id);
    expect(data![0].full_name).not.toBe("Hacked");
  });
});
