/**
 * The reads and writes behind a tournament game's answers, against the database
 * (docs/specs/tournaments-and-leagues.md §4, "Availability", D2, D19).
 *
 *   - a game's page reads the tournament's answers; a teammate, and a guardian
 *     answering for their child, can read them
 *   - an override is the game's own row; clearing it deletes only that row, so
 *     the tournament's answer is still there to fall back to
 *   - the availability grid's event projection carries each game's tournament
 */

import { describe, it, expect, afterAll } from "vitest";
import { adminClient, addTeamMember, cleanupTestData, createManagedProfile, createTestUser } from "./helpers";
import { createTournament, eventsOf, teamWithCoach } from "./tournament-fixtures";
import { fetchEventPage } from "@/lib/events/queries";

afterAll(cleanupTestData);

async function setting() {
  const { coach, teamId } = await teamWithCoach();
  const tournamentId = await createTournament(coach, teamId, { notify: false });
  const [game] = (await eventsOf(teamId)).filter((e) => e.tournament_id === tournamentId);

  const guardian = await createTestUser();
  const child = await createManagedProfile(guardian.user.id, { firstName: "Ava" });
  await addTeamMember(teamId, child, "player");
  const teammate = await createTestUser();
  await addTeamMember(teamId, teammate.user.id, "player");

  return { coach, teamId, tournamentId, gameId: game.id as string, guardian, child, teammate };
}

describe("a tournament game's answers", () => {
  it("a guardian answers the tournament for their child, and overrides one game", async () => {
    const { tournamentId, gameId, guardian, child } = await setting();

    const tournamentAnswer = await guardian.client
      .from("availability")
      .upsert({ event_id: tournamentId, profile_id: child, status: "available" }, { onConflict: "event_id,profile_id" });
    expect(tournamentAnswer.error).toBeNull();
    const override = await guardian.client
      .from("availability")
      .upsert({ event_id: gameId, profile_id: child, status: "unavailable" }, { onConflict: "event_id,profile_id" });
    expect(override.error).toBeNull();

    // What the game's page reads: the game's own answers, and the tournament's.
    const own = await guardian.client.from("availability").select("profile_id, status").eq("event_id", gameId);
    const inherited = await guardian.client.from("availability").select("profile_id, status").eq("event_id", tournamentId);
    expect(own.data).toEqual([{ profile_id: child, status: "unavailable" }]);
    expect(inherited.data).toEqual([{ profile_id: child, status: "available" }]);
  });

  it("clearing the override removes the game's row only, leaving the tournament's to fall back to", async () => {
    const { tournamentId, gameId, guardian, child } = await setting();
    await guardian.client.from("availability").upsert({ event_id: tournamentId, profile_id: child, status: "available" });
    await guardian.client.from("availability").upsert({ event_id: gameId, profile_id: child, status: "maybe" });

    const { error } = await guardian.client
      .from("availability")
      .delete()
      .eq("event_id", gameId)
      .eq("profile_id", child);

    expect(error).toBeNull();
    const { data } = await adminClient
      .from("availability")
      .select("event_id, status")
      .eq("profile_id", child)
      .in("event_id", [gameId, tournamentId]);
    expect(data).toEqual([{ event_id: tournamentId, status: "available" }]);
  });

  it("a teammate sees the tournament answers the game's list shows", async () => {
    const { tournamentId, guardian, child, teammate } = await setting();
    await guardian.client.from("availability").upsert({ event_id: tournamentId, profile_id: child, status: "available" });

    const { data, error } = await teammate.client
      .from("availability")
      .select("profile_id, status")
      .eq("event_id", tournamentId);

    expect(error).toBeNull();
    expect(data).toEqual([{ profile_id: child, status: "available" }]);
  });
});

describe("the availability grid's events", () => {
  it("carry each game's tournament", async () => {
    const { coach, teamId, tournamentId } = await setting();

    const page = await fetchEventPage(coach.client, {
      query: { teamId, includeCancelled: true },
      pageSize: 10,
      cursor: null,
      projection: "calendar",
    });

    const tournament = page.items.find((e) => e.id === tournamentId)!;
    expect(tournament.tournament_id).toBeNull();
    const games = page.items.filter((e) => e.event_type === "game");
    expect(games.length).toBeGreaterThan(0);
    expect(games.every((g) => g.tournament_id === tournamentId)).toBe(true);
  });
});
