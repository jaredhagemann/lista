import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  createManagedProfile,
  addOrgMember,
  cleanupTestData,
  adminClient,
} from "./helpers";

describe("team_members RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("team member can SELECT team members", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { data, error } = await coach.client
      .from("team_members")
      .select()
      .eq("team_id", teamId);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });

  it("non-member cannot SELECT team members", async () => {
    const coach = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const { data, error } = await outsider.client
      .from("team_members")
      .select()
      .eq("team_id", teamId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("admin can INSERT team members", async () => {
    const coach = await createTestUser();
    const newPlayer = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const { error } = await coach.client
      .from("team_members")
      .insert({ team_id: teamId, profile_id: newPlayer.user.id, role: "player" });
    expect(error).toBeNull();
  });

  // BUG-001: self-insertion used to succeed at any role, so knowing a team UUID
  // was enough to become its coach. Membership must come from an admin, an
  // accepted invitation, or a team-creation RPC — never a direct API insert.
  it.each(["player", "parent", "coach", "manager", "director"] as const)(
    "uninvited user cannot self-insert as %s",
    async (role) => {
      const coach = await createTestUser();
      const joiner = await createTestUser();
      const { teamId } = await createTestTeam(coach.user.id);

      const { error } = await joiner.client
        .from("team_members")
        .insert({ team_id: teamId, profile_id: joiner.user.id, role });
      expect(error).not.toBeNull();

      const { data: isAdmin } = await joiner.client.rpc("is_team_admin", { t_id: teamId });
      expect(isAdmin).toBe(false);
      const { data: visible } = await joiner.client
        .from("team_members")
        .select()
        .eq("team_id", teamId);
      expect(visible).toHaveLength(0);
    }
  );

  it("an org owner elsewhere cannot self-insert into another org's team", async () => {
    const coach = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const { orgId: otherOrgId } = await createTestTeam(outsider.user.id);
    await addOrgMember(otherOrgId, outsider.user.id, "owner");

    const { error } = await outsider.client
      .from("team_members")
      .insert({ team_id: teamId, profile_id: outsider.user.id, role: "coach" });
    expect(error).not.toBeNull();
  });

  it("org director can INSERT a member into a team in their org (implicit admin)", async () => {
    const coach = await createTestUser();
    const director = await createTestUser();
    const newPlayer = await createTestUser();
    const { orgId, teamId } = await createTestTeam(coach.user.id);
    await addOrgMember(orgId, director.user.id, "director");

    const { error } = await director.client
      .from("team_members")
      .insert({ team_id: teamId, profile_id: newPlayer.user.id, role: "player" });
    expect(error).toBeNull();
  });

  it("non-admin cannot INSERT other members", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const otherUser = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await player.client
      .from("team_members")
      .insert({ team_id: teamId, profile_id: otherUser.user.id, role: "player" });
    expect(error).not.toBeNull();
  });

  it("admin can UPDATE team members", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await coach.client
      .from("team_members")
      .update({ role: "manager" })
      .eq("team_id", teamId)
      .eq("profile_id", player.user.id);
    expect(error).toBeNull();
  });

  it("non-admin cannot UPDATE team members", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    await player.client
      .from("team_members")
      .update({ role: "coach" })
      .eq("team_id", teamId)
      .eq("profile_id", player.user.id);
    // RLS blocks — verify unchanged
    const { data } = await adminClient
      .from("team_members")
      .select()
      .eq("team_id", teamId)
      .eq("profile_id", player.user.id);
    expect(data![0].role).toBe("player");
  });

  it("admin can DELETE team members", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await coach.client
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("profile_id", player.user.id);
    expect(error).toBeNull();

    const { data } = await adminClient
      .from("team_members")
      .select()
      .eq("team_id", teamId)
      .eq("profile_id", player.user.id);
    expect(data).toHaveLength(0);
  });

  it("admin can DELETE another admin (coach)", async () => {
    const coach1 = await createTestUser();
    const coach2 = await createTestUser();
    const { teamId } = await createTestTeam(coach1.user.id);
    await addTeamMember(teamId, coach2.user.id, "coach");

    const { error } = await coach1.client
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("profile_id", coach2.user.id);
    expect(error).toBeNull();
  });

  it("player cannot DELETE a team member", async () => {
    const coach = await createTestUser();
    const player1 = await createTestUser();
    const player2 = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player1.user.id, "player");
    await addTeamMember(teamId, player2.user.id, "player");

    await player1.client
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("profile_id", player2.user.id);

    // Verify player2 still exists
    const { data } = await adminClient
      .from("team_members")
      .select()
      .eq("team_id", teamId)
      .eq("profile_id", player2.user.id);
    expect(data).toHaveLength(1);
  });

  it("after removal, ex-member cannot read team events", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    // Create an event for the team
    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Test Event",
      event_type: "practice",
      start_time: new Date(Date.now() + 86400000).toISOString(),
      end_time: new Date(Date.now() + 90000000).toISOString(),
    });

    // Verify player can see the event before removal
    const { data: before } = await player.client
      .from("events")
      .select()
      .eq("team_id", teamId);
    expect(before!.length).toBeGreaterThan(0);

    // Remove the player
    await adminClient
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("profile_id", player.user.id);

    // Verify player can no longer see the event
    const { data: after } = await player.client
      .from("events")
      .select()
      .eq("team_id", teamId);
    expect(after).toHaveLength(0);
  });

  it("after removal, profile manager loses team access if no other managed member remains", async () => {
    const coach = await createTestUser();
    const parent = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    // Parent manages a player profile on the team
    const managedProfileId = await createManagedProfile(parent.user.id);
    await addTeamMember(teamId, managedProfileId, "player");

    // Parent can see team events before removal
    const eventId = crypto.randomUUID();
    await adminClient.from("events").insert({
      id: eventId,
      team_id: teamId,
      title: "Test Event",
      event_type: "practice",
      start_time: new Date(Date.now() + 86400000).toISOString(),
      end_time: new Date(Date.now() + 90000000).toISOString(),
    });

    const { data: before } = await parent.client
      .from("events")
      .select()
      .eq("team_id", teamId);
    expect(before!.length).toBeGreaterThan(0);

    // Remove the managed player from the team
    await adminClient
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("profile_id", managedProfileId);

    // Parent should no longer have team access
    const { data: after } = await parent.client
      .from("events")
      .select()
      .eq("team_id", teamId);
    expect(after).toHaveLength(0);
  });
});
