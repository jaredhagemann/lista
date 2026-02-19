import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  cleanupTestData,
} from "./helpers";

describe("contacts RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("user can INSERT a contact for their own profile", async () => {
    const { client, user } = await createTestUser();

    const { error } = await client.from("contacts").insert({
      id: crypto.randomUUID(),
      profile_id: user.id,
      relationship: "Mother",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      phone: "555-1234",
    });
    expect(error).toBeNull();
  });

  it("user cannot INSERT a contact for another profile", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    const { error } = await user1.client.from("contacts").insert({
      id: crypto.randomUUID(),
      profile_id: user2.user.id,
      relationship: "Father",
      first_name: "Bob",
      last_name: "Smith",
    });
    expect(error).not.toBeNull();
  });

  it("user can SELECT their own contacts", async () => {
    const { client, user } = await createTestUser();

    const contactId = crypto.randomUUID();
    await client.from("contacts").insert({
      id: contactId,
      profile_id: user.id,
      relationship: "Self",
      first_name: "Test",
      last_name: "User",
    });

    const { data, error } = await client
      .from("contacts")
      .select()
      .eq("profile_id", user.id);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it("teammates can SELECT each other's contacts", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    // Player creates a contact
    const contactId = crypto.randomUUID();
    await player.client.from("contacts").insert({
      id: contactId,
      profile_id: player.user.id,
      relationship: "Mother",
      first_name: "Mom",
      last_name: "Player",
    });

    // Coach can see player's contacts
    const { data, error } = await coach.client
      .from("contacts")
      .select()
      .eq("profile_id", player.user.id);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it("non-teammates cannot SELECT contacts", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    // No shared team

    // user2 creates a contact
    await user2.client.from("contacts").insert({
      id: crypto.randomUUID(),
      profile_id: user2.user.id,
      relationship: "Self",
      first_name: "Private",
      last_name: "User",
    });

    const { data, error } = await user1.client
      .from("contacts")
      .select()
      .eq("profile_id", user2.user.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("user can UPDATE their own contacts", async () => {
    const { client, user } = await createTestUser();

    const contactId = crypto.randomUUID();
    await client.from("contacts").insert({
      id: contactId,
      profile_id: user.id,
      relationship: "Self",
      first_name: "Original",
      last_name: "Name",
    });

    const { error } = await client
      .from("contacts")
      .update({ first_name: "Updated" })
      .eq("id", contactId);
    expect(error).toBeNull();

    const { data } = await client
      .from("contacts")
      .select()
      .eq("id", contactId);
    expect(data![0].first_name).toBe("Updated");
  });

  it("user cannot UPDATE another user's contacts", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const contactId = crypto.randomUUID();
    await player.client.from("contacts").insert({
      id: contactId,
      profile_id: player.user.id,
      relationship: "Self",
      first_name: "Original",
      last_name: "Name",
    });

    // Coach tries to update player's contact
    await coach.client
      .from("contacts")
      .update({ first_name: "Hacked" })
      .eq("id", contactId);

    // Verify unchanged
    const { data } = await player.client
      .from("contacts")
      .select()
      .eq("id", contactId);
    expect(data![0].first_name).toBe("Original");
  });

  it("user can DELETE their own contacts", async () => {
    const { client, user } = await createTestUser();

    const contactId = crypto.randomUUID();
    await client.from("contacts").insert({
      id: contactId,
      profile_id: user.id,
      relationship: "Self",
      first_name: "Deleteme",
      last_name: "Contact",
    });

    const { error } = await client
      .from("contacts")
      .delete()
      .eq("id", contactId);
    expect(error).toBeNull();

    const { data } = await client
      .from("contacts")
      .select()
      .eq("id", contactId);
    expect(data).toHaveLength(0);
  });
});
