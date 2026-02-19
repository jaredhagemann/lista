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

  it("player cannot UPDATE another user's contacts", async () => {
    const coach = await createTestUser();
    const player1 = await createTestUser();
    const player2 = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player1.user.id, "player");
    await addTeamMember(teamId, player2.user.id, "player");

    const contactId = crypto.randomUUID();
    await player1.client.from("contacts").insert({
      id: contactId,
      profile_id: player1.user.id,
      relationship: "Self",
      first_name: "Original",
      last_name: "Name",
    });

    // Player2 tries to update player1's contact
    await player2.client
      .from("contacts")
      .update({ first_name: "Hacked" })
      .eq("id", contactId);

    // Verify unchanged
    const { data } = await player1.client
      .from("contacts")
      .select()
      .eq("id", contactId);
    expect(data![0].first_name).toBe("Original");
  });

  it("coach can INSERT a contact for a teammate", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const contactId = crypto.randomUUID();
    const { error } = await coach.client.from("contacts").insert({
      id: contactId,
      profile_id: player.user.id,
      relationship: "Emergency",
      first_name: "Coach",
      last_name: "Added",
    });
    expect(error).toBeNull();

    // Verify the contact was created
    const { data } = await player.client
      .from("contacts")
      .select()
      .eq("id", contactId);
    expect(data).toHaveLength(1);
    expect(data![0].first_name).toBe("Coach");
  });

  it("coach can UPDATE a teammate's contact", async () => {
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

    // Coach updates the player's contact
    const { error } = await coach.client
      .from("contacts")
      .update({ first_name: "Updated" })
      .eq("id", contactId);
    expect(error).toBeNull();

    // Verify changed
    const { data } = await player.client
      .from("contacts")
      .select()
      .eq("id", contactId);
    expect(data![0].first_name).toBe("Updated");
  });

  it("coach can DELETE a teammate's contact", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const contactId = crypto.randomUUID();
    await player.client.from("contacts").insert({
      id: contactId,
      profile_id: player.user.id,
      relationship: "Self",
      first_name: "Deleteme",
      last_name: "Contact",
    });

    // Coach deletes the player's contact
    const { error } = await coach.client
      .from("contacts")
      .delete()
      .eq("id", contactId);
    expect(error).toBeNull();

    // Verify deleted
    const { data } = await coach.client
      .from("contacts")
      .select()
      .eq("id", contactId);
    expect(data).toHaveLength(0);
  });

  it("manager can INSERT a contact for a teammate", async () => {
    const coach = await createTestUser();
    const manager = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, manager.user.id, "manager");
    await addTeamMember(teamId, player.user.id, "player");

    const contactId = crypto.randomUUID();
    const { error } = await manager.client.from("contacts").insert({
      id: contactId,
      profile_id: player.user.id,
      relationship: "Guardian",
      first_name: "Manager",
      last_name: "Added",
    });
    expect(error).toBeNull();
  });

  it("player cannot INSERT a contact for a teammate", async () => {
    const coach = await createTestUser();
    const player1 = await createTestUser();
    const player2 = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player1.user.id, "player");
    await addTeamMember(teamId, player2.user.id, "player");

    const { error } = await player1.client.from("contacts").insert({
      id: crypto.randomUUID(),
      profile_id: player2.user.id,
      relationship: "Self",
      first_name: "Sneaky",
      last_name: "Insert",
    });
    expect(error).not.toBeNull();
  });

  it("player cannot DELETE another user's contacts", async () => {
    const coach = await createTestUser();
    const player1 = await createTestUser();
    const player2 = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player1.user.id, "player");
    await addTeamMember(teamId, player2.user.id, "player");

    const contactId = crypto.randomUUID();
    await player1.client.from("contacts").insert({
      id: contactId,
      profile_id: player1.user.id,
      relationship: "Self",
      first_name: "Protected",
      last_name: "Contact",
    });

    // Player2 tries to delete player1's contact
    await player2.client
      .from("contacts")
      .delete()
      .eq("id", contactId);

    // Verify still exists
    const { data } = await player1.client
      .from("contacts")
      .select()
      .eq("id", contactId);
    expect(data).toHaveLength(1);
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
