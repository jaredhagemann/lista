/**
 * Uniform colors on teams (spec: docs/specs/game-display-and-uniform-colors.md).
 *
 * Each uniform can have an optional color, stored as #rrggbb (lowercase) or
 * null. Team admins set it through the existing team update permissions.
 */

import { describe, it, expect, afterAll } from "vitest";
import { adminClient, createTestUser, createTestTeam, addTeamMember, cleanupTestData } from "./helpers";

afterAll(cleanupTestData);

async function setup() {
  const coach = await createTestUser();
  const player = await createTestUser();
  const { teamId } = await createTestTeam(coach.user.id);
  await addTeamMember(teamId, player.user.id, "player");
  return { coach, player, teamId };
}

async function colors(teamId: string) {
  const { data } = await adminClient
    .from("teams")
    .select("home_uniform_color, away_uniform_color")
    .eq("id", teamId)
    .single();
  return data;
}

describe("teams.home_uniform_color / away_uniform_color", () => {
  it("a team admin can set and clear a color", async () => {
    const { coach, teamId } = await setup();

    const { error: setError } = await coach.client
      .from("teams")
      .update({ home_uniform_color: "#1e3a8a", away_uniform_color: "#ffffff" })
      .eq("id", teamId);
    expect(setError).toBeNull();
    expect(await colors(teamId)).toEqual({ home_uniform_color: "#1e3a8a", away_uniform_color: "#ffffff" });

    const { error: clearError } = await coach.client.from("teams").update({ home_uniform_color: null }).eq("id", teamId);
    expect(clearError).toBeNull();
    expect((await colors(teamId))?.home_uniform_color).toBeNull();
  });

  it.each(["red", "#fff", "#GGGGGG", "#1E3A8A", "1e3a8a", "#1e3a8a0"])("refuses %s", async (value) => {
    const { teamId } = await setup();

    const { error } = await adminClient.from("teams").update({ home_uniform_color: value }).eq("id", teamId);

    expect(error?.message).toMatch(/teams_uniform_color_format/);
  });

  it("a player cannot change the team's colors", async () => {
    const { player, teamId } = await setup();

    await player.client.from("teams").update({ home_uniform_color: "#dc2626" }).eq("id", teamId);

    expect((await colors(teamId))?.home_uniform_color).toBeNull();
  });
});
