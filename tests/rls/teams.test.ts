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

  it("authenticated user can INSERT a team into an existing org", async () => {
    const { client } = await createTestUser();

    // Org creation is service-role only; use admin to set up the org
    const orgId = crypto.randomUUID();
    await adminClient
      .from("organizations")
      .insert({ id: orgId, name: "Org", slug: `org-${orgId.slice(0, 8)}` });

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

    await player.client
      .from("teams")
      .update({ name: "Hacked" })
      .eq("id", teamId);
    // RLS blocks the update — no error, but 0 rows affected
    // Verify name unchanged
    const { data } = await adminClient.from("teams").select().eq("id", teamId);
    expect(data![0].name).not.toBe("Hacked");
  });

  it("team admin can UPDATE season", async () => {
    const { client, user } = await createTestUser();
    const { teamId } = await createTestTeam(user.id);

    const { error } = await client
      .from("teams")
      .update({ season: "Fall 2026" })
      .eq("id", teamId);
    expect(error).toBeNull();

    // Verify the update
    const { data } = await client.from("teams").select().eq("id", teamId);
    expect(data![0].season).toBe("Fall 2026");
  });

  it("non-admin member cannot UPDATE season", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    await player.client
      .from("teams")
      .update({ season: "Hacked Season" })
      .eq("id", teamId);
    // RLS blocks the update — no error, but 0 rows affected
    // Verify season unchanged
    const { data } = await adminClient.from("teams").select().eq("id", teamId);
    expect(data![0].season).not.toBe("Hacked Season");
  });

  it("admin can UPDATE all new team fields", async () => {
    const { client, user } = await createTestUser();
    const { teamId } = await createTestTeam(user.id);

    const updates = {
      sport: "soccer" as const,
      league: "AYSO Region 42",
      league_url: "https://ayso42.org",
      age_group: "10u" as const,
      gender: "coed" as const,
      home_uniform: "White jersey, blue shorts",
      away_uniform: "Blue jersey, white shorts",
      timezone: "America/Los_Angeles",
      country: "US",
      zip: "90210",
    };

    const { error } = await client
      .from("teams")
      .update(updates)
      .eq("id", teamId);
    expect(error).toBeNull();

    const { data } = await client.from("teams").select().eq("id", teamId);
    expect(data![0].sport).toBe("soccer");
    expect(data![0].league).toBe("AYSO Region 42");
    expect(data![0].league_url).toBe("https://ayso42.org");
    expect(data![0].age_group).toBe("10u");
    expect(data![0].gender).toBe("coed");
    expect(data![0].home_uniform).toBe("White jersey, blue shorts");
    expect(data![0].away_uniform).toBe("Blue jersey, white shorts");
    expect(data![0].timezone).toBe("America/Los_Angeles");
    expect(data![0].country).toBe("US");
    expect(data![0].zip).toBe("90210");
  });

  it("non-admin cannot UPDATE new team fields", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    await player.client
      .from("teams")
      .update({ sport: "soccer" })
      .eq("id", teamId);

    const { data } = await adminClient.from("teams").select().eq("id", teamId);
    expect(data![0].sport).toBeNull();
  });

  it("CHECK constraint rejects invalid sport", async () => {
    const { client, user } = await createTestUser();
    const { teamId } = await createTestTeam(user.id);

    const { error } = await client
      .from("teams")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ sport: "quidditch" as any })
      .eq("id", teamId);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514"); // check_violation
  });

  it("CHECK constraint rejects invalid age_group", async () => {
    const { client, user } = await createTestUser();
    const { teamId } = await createTestTeam(user.id);

    const { error } = await client
      .from("teams")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ age_group: "99u" as any })
      .eq("id", teamId);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("CHECK constraint rejects invalid gender", async () => {
    const { client, user } = await createTestUser();
    const { teamId } = await createTestTeam(user.id);

    const { error } = await client
      .from("teams")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ gender: "nonbinary" as any })
      .eq("id", teamId);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("admin can UPDATE logo_url and team_photo_url", async () => {
    const { client, user } = await createTestUser();
    const { teamId } = await createTestTeam(user.id);

    const { error } = await client
      .from("teams")
      .update({
        logo_url: "https://example.com/logo.png",
        team_photo_url: "https://example.com/team.png",
      })
      .eq("id", teamId);
    expect(error).toBeNull();

    const { data } = await client.from("teams").select().eq("id", teamId);
    expect(data![0].logo_url).toBe("https://example.com/logo.png");
    expect(data![0].team_photo_url).toBe("https://example.com/team.png");
  });

  it("non-admin cannot UPDATE logo_url or team_photo_url", async () => {
    const coach = await createTestUser();
    const player = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    await addTeamMember(teamId, player.user.id, "player");

    await player.client
      .from("teams")
      .update({ logo_url: "https://example.com/hacked.png" })
      .eq("id", teamId);

    const { data } = await adminClient.from("teams").select().eq("id", teamId);
    expect(data![0].logo_url).toBeNull();

    await player.client
      .from("teams")
      .update({ team_photo_url: "https://example.com/hacked.png" })
      .eq("id", teamId);

    const { data: data2 } = await adminClient.from("teams").select().eq("id", teamId);
    expect(data2![0].team_photo_url).toBeNull();
  });

  it("full team creation flow via create_team() RPC creates a visible team", async () => {
    // The client-side direct-insert path (org + team + member) was replaced by
    // the create_team() service-role RPC called from /api/teams. This test
    // verifies the new path: RPC creates org + team + membership atomically,
    // and the owner can immediately SELECT the team.
    const { client, user } = await createTestUser();

    const { data: teamId, error: rpcError } = await adminClient.rpc("create_team", {
      owner_profile_id: user.id,
      team_name: "U12 Blue",
      season: "Spring 2026",
      org_name: "My Club",
    });
    expect(rpcError).toBeNull();
    expect(typeof teamId).toBe("string");

    // Owner (now a team member via the RPC) should be able to SELECT the team
    const { data, error } = await client
      .from("teams")
      .select()
      .eq("id", teamId as string);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].name).toBe("U12 Blue");
  });
});
