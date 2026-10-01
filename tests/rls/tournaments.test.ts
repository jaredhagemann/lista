/**
 * Tournaments in the database (docs/specs/tournaments-and-leagues.md §4).
 *
 *   - a tournament is an event (event_type 'tournament') spanning whole days in
 *     its zone (D13); its games point at it through events.tournament_id, on the
 *     same team, and neither is ever part of a recurring series (D18)
 *   - placement is the tournament's, round is a game's, and only team admins
 *     write either
 *   - create_tournament saves the tournament and its games in one call, with one
 *     notice when asked
 *   - a plain delete or cancel of a tournament with upcoming games is refused;
 *     delete_tournament and cancel_tournament act on its games too, with one
 *     tournament notice and none per game (D5, D15)
 *   - set_unanswered_availability answers tournaments, never their games (D16,
 *     D16b)
 */

import { describe, it, expect, afterAll } from "vitest";
import { adminClient, createTestUser, addTeamMember, cleanupTestData } from "./helpers";
import {
  DAY_MS,
  ZONE,
  createTournament,
  day,
  eventsOf,
  game,
  insertEvent,
  jobsOf,
  local,
  teamWithCoach,
  type TestUser,
} from "./tournament-fixtures";

afterAll(cleanupTestData);

// ── The shape ─────────────────────────────────────────────────────────────────

describe("create_tournament", () => {
  it("saves a tournament over whole days in its zone, with its games linked, and one notice", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { firstDay: day(10), lastDay: day(12) });

    const events = await eventsOf(teamId);
    const tournament = events.find((e) => e.id === id)!;
    expect(tournament).toMatchObject({ event_type: "tournament", title: "Surf Cup", timezone: ZONE });
    // Inclusive days: midnight starting the first, to midnight ending the last.
    expect(local(tournament.start_time)).toBe(`${day(10)} 00:00`);
    expect(local(tournament.end_time)).toBe(`${day(13)} 00:00`);

    const games = events.filter((e) => e.tournament_id === id);
    expect(games.map((g) => [g.event_type, g.round])).toEqual([
      ["game", "Pool A"],
      ["game", "Semifinal"],
    ]);

    const jobs = await jobsOf(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ action: "created", event_id: id, occurrence_count: 1 });
    expect(jobs[0].snapshot).toMatchObject({ event_type: "tournament", title: "Surf Cup", tournament: { games: 2 } });
  });

  it("sends nothing when the coach unticks notify", async () => {
    const { coach, teamId } = await teamWithCoach();
    await createTournament(coach, teamId, { notify: false });

    expect(await jobsOf(teamId)).toHaveLength(0);
  });

  it("is refused for someone who isn't a team admin", async () => {
    const { teamId } = await teamWithCoach();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const { error } = await player.client.rpc("create_tournament", {
      p_team_id: teamId,
      p_title: "Surf Cup",
      p_first_day: day(10),
      p_last_day: day(12),
      p_games: [],
      p_notify: false,
    });

    expect(error?.message).toMatch(/NOT_AUTHORIZED/);
    expect(await eventsOf(teamId)).toHaveLength(0);
  });

  it("refuses a last day before the first", async () => {
    const { coach, teamId } = await teamWithCoach();

    await expect(createTournament(coach, teamId, { firstDay: day(12), lastDay: day(10) })).rejects.toThrow(
      /INVALID_TOURNAMENT_DAYS/
    );
  });
});

describe("what links to what", () => {
  it("a game links only to a tournament on its own team", async () => {
    const { teamId } = await teamWithCoach();
    const other = await teamWithCoach();
    const theirs = await createTournament(other.coach, other.teamId, { games: [] });

    const { error } = await insertEvent({ team_id: teamId, event_type: "game", tournament_id: theirs, ...game(240) });

    expect(error?.message).toMatch(/TOURNAMENT_TEAM_MISMATCH/);
  });

  it("a game links only to a tournament, not to another kind of event", async () => {
    const { teamId } = await teamWithCoach();
    const practiceId = crypto.randomUUID();
    await insertEvent({ id: practiceId, team_id: teamId, event_type: "practice", ...game(200) });

    const { error } = await insertEvent({ team_id: teamId, event_type: "game", tournament_id: practiceId, ...game(240) });

    expect(error?.message).toMatch(/NOT_A_TOURNAMENT/);
  });

  it("only a game carries a tournament or a round, and only a tournament a placement", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { games: [] });

    const practice = await insertEvent({ team_id: teamId, event_type: "practice", tournament_id: id, ...game(240) });
    const round = await insertEvent({ team_id: teamId, event_type: "practice", round: "Final", ...game(240) });
    const placement = await insertEvent({ team_id: teamId, event_type: "game", placement_rank: 1, ...game(240) });

    for (const { error } of [practice, round, placement]) expect(error?.message).toMatch(/check constraint/);
  });

  it("a tournament can't change into another type while it has games", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId);

    const { error } = await coach.client.from("events").update({ event_type: "other" }).eq("id", id);

    expect(error?.message).toMatch(/TOURNAMENT_HAS_GAMES|check constraint/);
  });
});

describe("tournaments and recurring series stay apart (D18)", () => {
  it("a recurring event or a series occurrence can't join a tournament", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { games: [] });
    const headId = crypto.randomUUID();
    await insertEvent({ id: headId, team_id: teamId, event_type: "game", recurrence_rule: "FREQ=WEEKLY;COUNT=3", ...game(300) });

    const asHead = await insertEvent({
      team_id: teamId,
      event_type: "game",
      tournament_id: id,
      recurrence_rule: "FREQ=WEEKLY;COUNT=3",
      ...game(240),
    });
    const asChild = await insertEvent({ team_id: teamId, event_type: "game", tournament_id: id, parent_event_id: headId, ...game(250) });

    expect(asHead.error?.message).toMatch(/check constraint/);
    expect(asChild.error?.message).toMatch(/check constraint/);
  });

  it("a tournament can't recur, and nothing can be an occurrence of a tournament or its game", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId);
    const [aGame] = (await eventsOf(teamId)).filter((e) => e.tournament_id === id);

    const recurring = await coach.client.from("events").update({ recurrence_rule: "FREQ=WEEKLY;COUNT=2" }).eq("id", id);
    const childOfTournament = await insertEvent({ team_id: teamId, event_type: "game", parent_event_id: id, ...game(400) });
    const childOfGame = await insertEvent({ team_id: teamId, event_type: "game", parent_event_id: aGame.id, ...game(400) });

    expect(recurring.error?.message).toMatch(/check constraint/);
    expect(childOfTournament.error?.message).toMatch(/TOURNAMENT_NOT_A_SERIES/);
    expect(childOfGame.error?.message).toMatch(/TOURNAMENT_NOT_A_SERIES/);
  });
});

describe("placement", () => {
  it("a team admin sets it; a player can't", async () => {
    const { coach, teamId } = await teamWithCoach();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const id = await createTournament(coach, teamId, { games: [] });

    await player.client.from("events").update({ placement_rank: 1 }).eq("id", id);
    const afterPlayer = (await eventsOf(teamId)).find((e) => e.id === id)!;
    const { error } = await coach.client
      .from("events")
      .update({ placement_rank: 2, placement_label: "Finalist" })
      .eq("id", id);
    const afterCoach = (await eventsOf(teamId)).find((e) => e.id === id)!;

    expect(afterPlayer.placement_rank).toBeNull();
    expect(error).toBeNull();
    expect(afterCoach).toMatchObject({ placement_rank: 2, placement_label: "Finalist" });
  });
});

// ── Deleting, cancelling, restoring ──────────────────────────────────────────

describe("deleting (D5)", () => {
  it("a plain delete of a tournament with games is refused", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId);

    const { error } = await coach.client.from("events").delete().eq("id", id);

    expect(error?.message).toMatch(/foreign key/);
    expect(await eventsOf(teamId)).toHaveLength(3);
  });

  it("delete_tournament removes it, its games and their answers, with one notice and none per game", async () => {
    const { coach, teamId } = await teamWithCoach();
    const standaloneId = crypto.randomUUID();
    await insertEvent({ id: standaloneId, team_id: teamId, event_type: "game", ...game(500) });
    const id = await createTournament(coach, teamId, { notify: false });
    const games = (await eventsOf(teamId)).filter((e) => e.tournament_id === id);
    await adminClient.from("availability").insert({ event_id: games[0].id, profile_id: coach.user.id, status: "available" });

    const { data, error } = await coach.client.rpc("delete_tournament", { p_tournament_id: id });

    expect(error).toBeNull();
    expect(data).toBe(3);
    expect((await eventsOf(teamId)).map((e) => e.id)).toEqual([standaloneId]);
    const { data: answers } = await adminClient.from("availability").select("event_id").eq("event_id", games[0].id);
    expect(answers).toEqual([]);

    const jobs = await jobsOf(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ action: "deleted", event_id: id });
    expect(jobs[0].snapshot).toMatchObject({ event_type: "tournament", tournament: { games: 2, affected: 2 } });
  });

  it("is refused for someone who isn't a team admin", async () => {
    const { coach, teamId } = await teamWithCoach();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const id = await createTournament(coach, teamId);

    const { error } = await player.client.rpc("delete_tournament", { p_tournament_id: id });

    expect(error?.message).toMatch(/NOT_AUTHORIZED/);
    expect(await eventsOf(teamId)).toHaveLength(3);
  });
});

describe("cancelling and restoring (D15)", () => {
  // Underway: started yesterday, ends after tomorrow. One game played, two to come.
  async function underway(coach: TestUser, teamId: string) {
    return createTournament(coach, teamId, {
      firstDay: day(-1),
      lastDay: day(2),
      games: [game(-20), game(20), game(30)],
      notify: false,
    });
  }

  it("a plain cancel of a tournament with upcoming games is refused", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await underway(coach, teamId);

    const { error } = await coach.client.from("events").update({ is_cancelled: true }).eq("id", id);

    expect(error?.message).toMatch(/TOURNAMENT_HAS_GAMES/);
  });

  it("cancel with its games: the upcoming games are cancelled, the played one keeps its place, one notice", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await underway(coach, teamId);

    const { data, error } = await coach.client.rpc("cancel_tournament", { p_tournament_id: id, p_cancel_games: true });

    expect(error).toBeNull();
    expect(data).toBe(2);
    const events = await eventsOf(teamId);
    expect(events.find((e) => e.id === id)!.is_cancelled).toBe(true);
    const games = events.filter((e) => e.tournament_id === id);
    expect(games.map((g) => g.is_cancelled)).toEqual([false, true, true]);

    const jobs = await jobsOf(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ action: "cancelled", event_id: id });
    expect(jobs[0].snapshot.tournament).toMatchObject({ games: 3, affected: 2, games_action: "cancelled" });
  });

  it("cancel keeping its games: the upcoming games stay on the schedule, unlinked; the played one stays linked", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await underway(coach, teamId);

    const { data, error } = await coach.client.rpc("cancel_tournament", { p_tournament_id: id, p_cancel_games: false });

    expect(error).toBeNull();
    expect(data).toBe(2);
    const events = await eventsOf(teamId);
    const games = events.filter((e) => e.event_type === "game");
    expect(games.map((g) => [g.tournament_id === id, g.is_cancelled])).toEqual([
      [true, false],
      [false, false],
      [false, false],
    ]);

    const jobs = await jobsOf(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].snapshot.tournament).toMatchObject({ affected: 2, games_action: "kept" });
  });

  it("restoring the tournament leaves its cancelled games cancelled", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await underway(coach, teamId);
    await coach.client.rpc("cancel_tournament", { p_tournament_id: id, p_cancel_games: true });

    const { error } = await coach.client.from("events").update({ is_cancelled: false }).eq("id", id);

    expect(error).toBeNull();
    const games = (await eventsOf(teamId)).filter((e) => e.tournament_id === id);
    expect(games.map((g) => g.is_cancelled)).toEqual([false, true, true]);
    const jobs = await jobsOf(teamId);
    expect(jobs.map((j) => j.action)).toEqual(["cancelled", "restored"]);
  });

  it("a game's own notice names its tournament and round", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { notify: false });
    const [first] = (await eventsOf(teamId)).filter((e) => e.tournament_id === id);

    await coach.client
      .from("events")
      .update({ start_time: new Date(Date.parse(first.start_time) + 3600_000).toISOString() })
      .eq("id", first.id);

    const jobs = await jobsOf(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].snapshot).toMatchObject({ event_type: "game", round: "Pool A", tournament_title: "Surf Cup" });
  });
});

// ── Bulk answers (D16, D16b) ─────────────────────────────────────────────────

describe("set_unanswered_availability", () => {
  async function setUp() {
    const { coach, teamId } = await teamWithCoach();
    const parent = await createTestUser();
    await addTeamMember(teamId, parent.user.id, "player");
    const id = await createTournament(coach, teamId, { notify: false });
    const standaloneId = crypto.randomUUID();
    await insertEvent({ id: standaloneId, team_id: teamId, event_type: "game", ...game(48) });
    return { teamId, parent, id, standaloneId };
  }

  async function fill(user: TestUser, teamId: string, eventType: string | null) {
    const { data, error } = await user.client.rpc("set_unanswered_availability", {
      p_team_id: teamId,
      p_profile_id: user.user.id,
      p_from: new Date().toISOString(),
      p_to: new Date(Date.now() + 60 * DAY_MS).toISOString(),
      p_status: "available",
      p_event_type: eventType,
    });
    if (error) throw new Error(error.message);
    return data as number;
  }

  async function answered(user: TestUser) {
    const { data } = await adminClient.from("availability").select("event_id").eq("profile_id", user.user.id);
    return (data ?? []).map((r) => r.event_id).sort();
  }

  it("answers the tournament, not its games, and standalone games as before", async () => {
    const { teamId, parent, id, standaloneId } = await setUp();

    expect(await fill(parent, teamId, null)).toBe(2);
    expect(await answered(parent)).toEqual([id, standaloneId].sort());
  });

  it("the 'game' filter covers standalone games only (D16b)", async () => {
    const { teamId, parent, standaloneId } = await setUp();

    expect(await fill(parent, teamId, "game")).toBe(1);
    expect(await answered(parent)).toEqual([standaloneId]);
  });

  it("the 'tournament' filter answers tournaments", async () => {
    const { teamId, parent, id } = await setUp();

    expect(await fill(parent, teamId, "tournament")).toBe(1);
    expect(await answered(parent)).toEqual([id]);
  });

  it("reaches a tournament that's already underway through its upcoming games", async () => {
    const { coach, teamId } = await teamWithCoach();
    const parent = await createTestUser();
    await addTeamMember(teamId, parent.user.id, "player");
    const id = await createTournament(coach, teamId, {
      firstDay: day(-1),
      lastDay: day(2),
      games: [game(20)],
      notify: false,
    });

    expect(await fill(parent, teamId, null)).toBe(1);
    expect(await answered(parent)).toEqual([id]);
  });
});
