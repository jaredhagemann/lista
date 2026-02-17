import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  addTeamMember,
  cleanupTestData,
  adminClient,
} from "./helpers";

describe("teams RLS", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it("team member can SELECT their team", async () => {
    const { client, user } = await createTestUser();
    const { teamId } = await createTestTeam(user.id);

    const { data, error } = await client.from("teams").select().eq("id", teamId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("non-member cannot SELECT a team", async () => {
    const coach = await createTestUser();
    const outsider = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);

    const { data, error } = await outsider.client
      .from("teams")
      .select()
      .eq("id", teamId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("authenticated user can INSERT a team", async () => {
    const { client } = await createTestUser();

    const orgId = crypto.randomUUID();
    await client.from("organizations").insert({ id: orgId, name: "Org" });

    const { error } = await client
      .from("teams")
      .insert({ organization_id: orgId, name: "New Team" });
    expect(error).toBeNull();
  });

  it("team admin can UPDATE their team", async () => {
    const { client, user } = await createTestUser();
    const { teamId } = await createTestTeam(user.id);

    const { error } = await client
      .from("teams")
      .update({ name: "Updated Name" })
      .eq("id", teamId);
    expect(error).toBeNull();

    // Verify the update
    const { data } = await client.from("teams").select().eq("id", teamId);
    expect(data![0].name).toBe("Updated Name");
  });

  it("non-admin member cannot UPDATE a team", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await player.client
      .from("teams")
      .update({ name: "Hacked" })
      .eq("id", teamId);
    // RLS blocks the update — no error, but 0 rows affected
    // Verify name unchanged
    const { data } = await adminClient.from("teams").select().eq("id", teamId);
    expect(data![0].name).not.toBe("Hacked");
  });

  it("REGRESSION: full team creation flow with client-side UUIDs works", async () => {
    const { client, user } = await createTestUser();

    // Replicate the fixed create-team-form flow
    const orgId = crypto.randomUUID();
    const { error: orgError } = await client
      .from("organizations")
      .insert({ id: orgId, name: "My Club" });
    expect(orgError).toBeNull();

    const teamId = crypto.randomUUID();
    const { error: teamError } = await client
      .from("teams")
      .insert({ id: teamId, organization_id: orgId, name: "U12 Blue", season: "Spring 2026" });
    expect(teamError).toBeNull();

    const { error: memberError } = await client
      .from("team_members")
      .insert({ team_id: teamId, profile_id: user.id, role: "coach" });
    expect(memberError).toBeNull();

    // Now the user should be able to see the team
    const { data, error } = await client.from("teams").select().eq("id", teamId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].name).toBe("U12 Blue");
  });
});
