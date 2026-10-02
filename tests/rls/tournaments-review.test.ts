/**
 * Regression tests for the part 1 review findings, TL-001 to TL-006
 * (docs/reviews/2026-10-01-tournaments-and-leagues-review.md). Each describe
 * block is one finding, reproducing its failure and covering the legitimate
 * case next to it.
 */

import { spawn, execSync } from "node:child_process";
import { describe, it, expect, afterAll } from "vitest";
import { adminClient, createTestUser, addTeamMember, cleanupTestData } from "./helpers";
import {
  DAY_MS,
  createTournament,
  day,
  eventsOf,
  game,
  insertEvent,
  jobsOf,
  teamWithCoach,
  type TestUser,
} from "./tournament-fixtures";

afterAll(cleanupTestData);

/** Runs SQL in its own psql session. Resolves with its exit code and output. */
function psqlSession(sql: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const p = spawn("docker", ["exec", "-i", "supabase_db_lista", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]);
    let output = "";
    p.stdout.on("data", (d) => (output += d));
    p.stderr.on("data", (d) => (output += d));
    p.on("close", (code) => resolve({ code: code ?? 1, output }));
    p.stdin.end(sql);
  });
}

function psqlValue(sql: string): string {
  return execSync("docker exec -i supabase_db_lista psql -U postgres -d postgres -tA", { input: sql })
    .toString()
    .trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function gameInsertSql(teamId: string, tournamentId: string) {
  const start = new Date(Date.now() + 240 * 3600_000).toISOString();
  const end = new Date(Date.now() + 241 * 3600_000).toISOString();
  return `insert into events (id, team_id, title, event_type, start_time, end_time, tournament_id)
    values (gen_random_uuid(), '${teamId}', 'Game', 'game', '${start}', '${end}', '${tournamentId}');`;
}

// ── TL-001 ───────────────────────────────────────────────────────────────────

describe("TL-001: a tournament's links stay valid when edits overlap", () => {
  /** `first` runs in a transaction held open for 2s; `second` starts inside that window. */
  async function overlap(first: string, second: string) {
    const a = psqlSession(`begin; ${first} select pg_sleep(2); commit;`);
    await sleep(700);
    const b = await psqlSession(second);
    return { a: await a, b };
  }

  const linkedToNonTournament = (id: string) =>
    psqlValue(
      `select count(*) from events g join events t on t.id = g.tournament_id where t.id = '${id}' and t.event_type <> 'tournament';`
    );

  it("a game linked while its tournament changes type: one of them is refused", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { games: [] });

    const { a, b } = await overlap(`update events set event_type = 'other' where id = '${id}';`, gameInsertSql(teamId, id));

    expect(a.code === 0 && b.code === 0).toBe(false);
    expect(linkedToNonTournament(id)).toBe("0");
  });

  it("a tournament changing type while a game is being linked: one of them is refused", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { games: [] });

    const { a, b } = await overlap(gameInsertSql(teamId, id), `update events set event_type = 'other' where id = '${id}';`);

    expect(a.code === 0 && b.code === 0).toBe(false);
    expect(linkedToNonTournament(id)).toBe("0");
  });

  it("a game linked while its tournament moves team: one of them is refused", async () => {
    const { coach, teamId } = await teamWithCoach();
    const other = await teamWithCoach();
    const id = await createTournament(coach, teamId, { games: [] });

    const { a, b } = await overlap(
      `update events set team_id = '${other.teamId}' where id = '${id}';`,
      gameInsertSql(teamId, id)
    );

    expect(a.code === 0 && b.code === 0).toBe(false);
    const crossTeam = psqlValue(
      `select count(*) from events g join events t on t.id = g.tournament_id where t.id = '${id}' and t.team_id <> g.team_id;`
    );
    expect(crossTeam).toBe("0");
  });

  it("linking a game to an unchanged tournament still works", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { games: [] });

    const { code } = await psqlSession(gameInsertSql(teamId, id));

    expect(code).toBe(0);
    expect(psqlValue(`select count(*) from events where tournament_id = '${id}';`)).toBe("1");
  });
});

// ── TL-002 ───────────────────────────────────────────────────────────────────

describe("TL-002: a series head with occurrences can't join a tournament", () => {
  async function seriesWithChild(teamId: string) {
    const headId = crypto.randomUUID();
    await insertEvent({ id: headId, team_id: teamId, event_type: "game", recurrence_rule: "FREQ=WEEKLY;COUNT=2", ...game(300) });
    const childId = crypto.randomUUID();
    await insertEvent({ id: childId, team_id: teamId, event_type: "game", parent_event_id: headId, ...game(468) });
    return { headId, childId };
  }

  it("clearing its rule to join a tournament is refused, and the series is kept", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { games: [] });
    const { headId, childId } = await seriesWithChild(teamId);

    const { error } = await coach.client.from("events").update({ recurrence_rule: null, tournament_id: id }).eq("id", headId);

    expect(error?.message).toMatch(/TOURNAMENT_NOT_A_SERIES/);
    const events = await eventsOf(teamId);
    expect(events.find((e) => e.id === headId)).toMatchObject({ tournament_id: null, recurrence_rule: "FREQ=WEEKLY;COUNT=2" });
    expect(events.find((e) => e.id === childId)!.parent_event_id).toBe(headId);
  });

  it("clearing its rule to become a tournament is refused", async () => {
    const { coach, teamId } = await teamWithCoach();
    const { headId } = await seriesWithChild(teamId);

    const { error } = await coach.client
      .from("events")
      .update({ recurrence_rule: null, event_type: "tournament" })
      .eq("id", headId);

    expect(error?.message).toMatch(/TOURNAMENT_NOT_A_SERIES/);
  });

  it("a standalone game can still join a tournament, and a standalone event become one", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { games: [] });
    const gameId = crypto.randomUUID();
    const otherId = crypto.randomUUID();
    await insertEvent({ id: gameId, team_id: teamId, event_type: "game", ...game(300) });
    await insertEvent({ id: otherId, team_id: teamId, event_type: "other", ...game(320) });

    const joined = await coach.client.from("events").update({ tournament_id: id }).eq("id", gameId);
    const became = await coach.client.from("events").update({ event_type: "tournament" }).eq("id", otherId);

    expect(joined.error).toBeNull();
    expect(became.error).toBeNull();
  });
});

// ── TL-003 ───────────────────────────────────────────────────────────────────

describe("TL-003: bulk fill stays inside the chosen window", () => {
  async function fill(user: TestUser, teamId: string, days: number, eventType: string | null = null) {
    const { data, error } = await user.client.rpc("set_unanswered_availability", {
      p_team_id: teamId,
      p_profile_id: user.user.id,
      p_from: new Date().toISOString(),
      p_to: new Date(Date.now() + days * DAY_MS).toISOString(),
      p_status: "available",
      p_event_type: eventType,
    });
    if (error) throw new Error(error.message);
    return data as number;
  }

  async function underwayWithGames(games: unknown[]) {
    const { coach, teamId } = await teamWithCoach();
    const parent = await createTestUser();
    await addTeamMember(teamId, parent.user.id, "player");
    const id = await createTournament(coach, teamId, { firstDay: day(-1), lastDay: day(10), games, notify: false });
    const gameIds = (await eventsOf(teamId)).filter((e) => e.tournament_id === id).map((e) => e.id);
    return { teamId, parent, id, gameIds };
  }

  async function answeredBy(user: TestUser) {
    const { data } = await adminClient.from("availability").select("event_id").eq("profile_id", user.user.id);
    return (data ?? []).map((r) => r.event_id);
  }

  it("an answered game doesn't pull its tournament into the fill", async () => {
    // Tomorrow's game is answered Unavailable; the one nine days out is outside a two-day window.
    const { teamId, parent, gameIds } = await underwayWithGames([game(24), game(9 * 24)]);
    await adminClient.from("availability").insert({ event_id: gameIds[0], profile_id: parent.user.id, status: "unavailable" });

    expect(await fill(parent, teamId, 2)).toBe(0);
    expect(await answeredBy(parent)).toEqual([gameIds[0]]);
  });

  it("an unanswered game in the window still reaches its underway tournament", async () => {
    const { teamId, parent, id } = await underwayWithGames([game(24), game(9 * 24)]);

    expect(await fill(parent, teamId, 2)).toBe(1);
    expect(await answeredBy(parent)).toEqual([id]);
  });

  it("an answered tournament isn't answered again, and the 'game' filter stays standalone-only", async () => {
    const { teamId, parent, id } = await underwayWithGames([game(24)]);
    await adminClient.from("availability").insert({ event_id: id, profile_id: parent.user.id, status: "maybe" });

    expect(await fill(parent, teamId, 2)).toBe(0);
    expect(await fill(parent, teamId, 2, "game")).toBe(0);
  });
});

// ── TL-004 ───────────────────────────────────────────────────────────────────

describe("TL-004: deleting a tournament tells people when it removes live games", () => {
  it("a cancelled tournament whose game was restored: one notice, naming the game", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { games: [game(48)], notify: false });
    await coach.client.rpc("cancel_tournament", { p_tournament_id: id, p_cancel_games: true });
    const [g] = (await eventsOf(teamId)).filter((e) => e.tournament_id === id);
    await coach.client.from("events").update({ is_cancelled: false }).eq("id", g.id);
    const before = (await jobsOf(teamId)).length;

    await coach.client.rpc("delete_tournament", { p_tournament_id: id });

    const jobs = (await jobsOf(teamId)).slice(before);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ action: "deleted", event_id: id });
    expect(jobs[0].snapshot.tournament.affected_games.map((x: { id: string }) => x.id)).toEqual([g.id]);
  });

  it("an ended tournament with a game moved past it: one notice", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { firstDay: day(-5), lastDay: day(-3), games: [game(48)], notify: false });

    await coach.client.rpc("delete_tournament", { p_tournament_id: id });

    const jobs = await jobsOf(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].action).toBe("deleted");
  });

  it("nothing live removed: no notice", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { firstDay: day(-5), lastDay: day(-3), games: [game(-90)], notify: false });

    await coach.client.rpc("delete_tournament", { p_tournament_id: id });

    expect(await jobsOf(teamId)).toHaveLength(0);
  });
});

// ── TL-005 ───────────────────────────────────────────────────────────────────

describe("TL-005: notices carry the games they're about", () => {
  it("cancel keeping its games: the notice lists exactly those games, usable after they change", async () => {
    const { coach, teamId } = await teamWithCoach();
    const standaloneId = crypto.randomUUID();
    await insertEvent({ id: standaloneId, team_id: teamId, event_type: "game", ...game(30) });
    const id = await createTournament(coach, teamId, {
      firstDay: day(-1),
      lastDay: day(5),
      games: [game(-20, { round: "Pool A" }), game(20, { round: "Pool B", opponent: "Eagles" }), game(40, { round: "Final" })],
      notify: false,
    });
    const upcoming = (await eventsOf(teamId)).filter((e) => e.tournament_id === id && Date.parse(e.start_time) > Date.now());

    await coach.client.rpc("cancel_tournament", { p_tournament_id: id, p_cancel_games: false });
    await adminClient.from("events").delete().eq("id", upcoming[1].id);

    const [job] = await jobsOf(teamId);
    const listed = job.snapshot.tournament.affected_games as Array<Record<string, unknown>>;
    expect(listed.map((g) => g.id)).toEqual(upcoming.map((g) => g.id));
    expect(listed[0]).toMatchObject({ round: "Pool B", opponent: "Eagles", title: "Game" });
    expect(Date.parse(listed[0].start_time as string)).toBe(Date.parse(upcoming[0].start_time));
  });

  it("creating lists its games", async () => {
    const { coach, teamId } = await teamWithCoach();
    await createTournament(coach, teamId);

    const [job] = await jobsOf(teamId);
    expect((job.snapshot.tournament.affected_games as Array<{ round: string }>).map((g) => g.round)).toEqual([
      "Pool A",
      "Semifinal",
    ]);
  });
});

// ── TL-006 ───────────────────────────────────────────────────────────────────

describe("TL-006: a tournament that's already over is entered silently", () => {
  it("historical creation with notify requested queues nothing", async () => {
    const { coach, teamId } = await teamWithCoach();

    await createTournament(coach, teamId, { firstDay: day(-10), lastDay: day(-8), games: [] });

    expect(await jobsOf(teamId)).toHaveLength(0);
  });

  it("upcoming creation still queues one notice, and none when notify is off", async () => {
    const quiet = await teamWithCoach();
    const loud = await teamWithCoach();

    await createTournament(quiet.coach, quiet.teamId, { games: [], notify: false });
    await createTournament(loud.coach, loud.teamId, { games: [] });

    expect(await jobsOf(quiet.teamId)).toHaveLength(0);
    expect(await jobsOf(loud.teamId)).toHaveLength(1);
  });
});
