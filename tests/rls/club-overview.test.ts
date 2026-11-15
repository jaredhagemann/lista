/**
 * The Club Overview reads every team's events and results as the viewer, so it
 * depends on these rules: an owner or director sees all of their club's teams,
 * including a team they aren't on, and nobody else does.
 *
 * Requires the local Supabase stack. Run with: pnpm test:rls
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminClient, createTestUser, createTestTeam, cleanupTestData } from "./helpers";

let directorClient: Awaited<ReturnType<typeof createTestUser>>["client"];
let outsiderClient: Awaited<ReturnType<typeof createTestUser>>["client"];
let directorId: string;
let otherTeamId: string;
let eventId: string;

beforeAll(async () => {
  const coach = await createTestUser();
  const director = await createTestUser();
  const outsider = await createTestUser();
  directorClient = director.client;
  directorId = director.user.id;
  outsiderClient = outsider.client;

  const { orgId, teamId } = await createTestTeam(coach.user.id);
  otherTeamId = teamId;
  await createTestTeam(outsider.user.id);

  const { error: memberError } = await adminClient
    .from("organization_members")
    .insert({ organization_id: orgId, profile_id: director.user.id, role: "director" });
  expect(memberError).toBeNull();

  eventId = crypto.randomUUID();
  const { error: eventError } = await adminClient.from("events").insert({
    id: eventId,
    team_id: otherTeamId,
    title: "Game",
    event_type: "game",
    opponent: "Rivals",
    game_result: "win",
    start_time: "2026-10-01T18:00:00Z",
    end_time: "2026-10-01T19:00:00Z",
    created_by: coach.user.id,
  });
  expect(eventError).toBeNull();
});

afterAll(async () => {
  await adminClient.from("events").delete().eq("id", eventId);
  await cleanupTestData();
});

describe("reading a club team's events", () => {
  it("lets a director who isn't on the team", async () => {
    const { data: membership } = await adminClient
      .from("team_members")
      .select("id")
      .eq("team_id", otherTeamId)
      .eq("profile_id", directorId);
    expect(membership).toEqual([]);

    const { data, error } = await directorClient
      .from("events")
      .select("id, game_result")
      .eq("team_id", otherTeamId);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: eventId, game_result: "win" }]);
  });

  it("doesn't let someone from outside the club", async () => {
    const { data } = await outsiderClient.from("events").select("id").eq("team_id", otherTeamId);

    expect(data).toEqual([]);
  });
});
