/**
 * The writes the web makes to manage a tournament, beyond its database
 * functions (docs/specs/tournaments-and-leagues.md §4; part 2b).
 *
 *   - its edit form updates the tournament row alone: new days never move its
 *     games, and notify like any event's times (D3); a placement or a name
 *     never does by itself
 *   - "Add a game" inserts a game linked to it, as a coach, and queues its
 *     creation notice, which names the tournament and round
 *   - a game's page reads its tournament's days through the embed, so its
 *     editor can warn about a game outside them
 */

import { describe, it, expect, afterAll } from "vitest";
import { addTeamMember, cleanupTestData, createTestUser } from "./helpers";
import { ZONE, createTournament, day, eventsOf, game, jobsOf, local, teamWithCoach } from "./tournament-fixtures";

afterAll(cleanupTestData);

/** Midnight starting `first` to midnight ending `last`, as the edit form computes it. */
async function boundsOf(coachClient: Awaited<ReturnType<typeof teamWithCoach>>["coach"]["client"], id: string) {
  const { data } = await coachClient.from("events").select("start_time, end_time").eq("id", id).single();
  return data!;
}

describe("editing a tournament", () => {
  it("new days update the tournament alone, and notify once, as the tournament", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { firstDay: day(10), lastDay: day(12), notify: false });
    const before = await eventsOf(teamId);
    const { end_time } = await boundsOf(coach.client, id);

    // One more day: the form sends midnight ending the new last day.
    const later = new Date(Date.parse(end_time) + 24 * 60 * 60 * 1000).toISOString();
    const { error } = await coach.client.from("events").update({ end_time: later, timezone: ZONE }).eq("id", id);

    expect(error).toBeNull();
    const after = await eventsOf(teamId);
    expect(local(after.find((e) => e.id === id)!.end_time)).toBe(`${day(14)} 00:00`);
    // Its games are where they were.
    const games = (rows: typeof before) =>
      rows.filter((e) => e.tournament_id === id).map((g) => [g.id, g.start_time, g.end_time]);
    expect(games(after)).toEqual(games(before));

    const jobs = await jobsOf(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ action: "updated", event_id: id });
    expect(jobs[0].snapshot).toMatchObject({ event_type: "tournament", title: "Surf Cup" });
  });

  it("a name, notes or placement change notifies nobody by itself", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { notify: false });

    const { error } = await coach.client
      .from("events")
      .update({ title: "Surf Cup 2026", notes: "Check in at 8", placement_rank: 2, placement_label: "Silver bracket" })
      .eq("id", id);

    expect(error).toBeNull();
    expect(await jobsOf(teamId)).toHaveLength(0);
  });

  it("is refused for a parent", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { notify: false });
    const parent = await createTestUser();
    await addTeamMember(teamId, parent.user.id, "parent");

    await parent.client.from("events").update({ title: "Renamed", placement_rank: 1 }).eq("id", id);

    const row = (await eventsOf(teamId)).find((e) => e.id === id)!;
    expect(row).toMatchObject({ title: "Surf Cup", placement_rank: null });
  });
});

describe("adding a game to a tournament", () => {
  it("a coach inserts a linked game, and its notice names the tournament and round", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { games: [], notify: false });

    const gameId = crypto.randomUUID();
    const { error } = await coach.client.from("events").insert({
      id: gameId,
      team_id: teamId,
      tournament_id: id,
      event_type: "game",
      timezone: ZONE,
      created_by: coach.user.id,
      ...game(10 * 24 + 4, { title: "Final", opponent: null, home_away: null, round: "Final" }),
    });
    expect(error).toBeNull();

    // An insert queues nothing by itself (D3): the form asks.
    expect(await jobsOf(teamId)).toHaveLength(0);
    const { error: queueError } = await coach.client.rpc("enqueue_event_notification", {
      p_event_id: gameId,
      p_action: "created",
    });
    expect(queueError).toBeNull();

    const jobs = await jobsOf(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].snapshot).toMatchObject({ event_type: "game", round: "Final", tournament_title: "Surf Cup" });
  });

  it("a parent can't add a game to it", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { games: [], notify: false });
    const parent = await createTestUser();
    await addTeamMember(teamId, parent.user.id, "parent");

    const { error } = await parent.client.from("events").insert({
      id: crypto.randomUUID(),
      team_id: teamId,
      tournament_id: id,
      event_type: "game",
      ...game(10 * 24 + 4),
    });

    expect(error).not.toBeNull();
    expect((await eventsOf(teamId)).filter((e) => e.tournament_id === id)).toHaveLength(0);
  });
});

describe("a game's page", () => {
  it("reads its tournament's days through the embed, as a player", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { firstDay: day(10), lastDay: day(12), notify: false });
    const [first] = (await eventsOf(teamId)).filter((e) => e.tournament_id === id);
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const { data, error } = await player.client
      .from("events")
      .select("id, tournament:tournament_id(id, title, start_time, end_time, timezone)")
      .eq("id", first.id)
      .single();

    expect(error).toBeNull();
    const tournament = (data as unknown as { tournament: { id: string; title: string; start_time: string; end_time: string; timezone: string } })
      .tournament;
    expect(tournament).toMatchObject({ id, title: "Surf Cup", timezone: ZONE });
    expect(local(tournament.start_time)).toBe(`${day(10)} 00:00`);
    expect(local(tournament.end_time)).toBe(`${day(13)} 00:00`);
  });
});
