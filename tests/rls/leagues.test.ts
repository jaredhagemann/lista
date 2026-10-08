/**
 * Leagues in the database (docs/specs/tournaments-and-leagues.md §5; D4, D9,
 * D10, D17, D20, D21).
 *
 *   - a league is a team's, for one season: name and season, both required.
 *     Teammates read it; coaches and managers write it
 *   - one league per name and season on a team, ignoring case and spaces (D21)
 *   - archiving hides a league, and keeps its games' tags (D17)
 *   - a league with games can't be deleted: archive it instead (D20). A team's
 *     own deletion still takes its leagues and games with it
 *   - a game carries a league of its own team, and only a game does. Tagging is
 *     classification, never schedule news: it notifies nobody, past games
 *     included. A tournament's game can carry a league too (D4)
 *   - a closed club's leagues are read-only, as its other tables are
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
  addOrgMember,
  addTeamMember,
  cleanupTestData,
  createTestTeam,
  createTestUser,
  setOrgPlan,
} from "./helpers";
import { createTournament, eventsOf, game, insertEvent, jobsOf, teamWithCoach } from "./tournament-fixtures";

afterAll(cleanupTestData);


async function league(client: Awaited<ReturnType<typeof teamWithCoach>>["coach"]["client"], teamId: string, name = "Division 3", season = "Fall 2026") {
  const id = crypto.randomUUID();
  const { error } = await client.from("leagues").insert({ id, team_id: teamId, name, season });
  return { id, error };
}

/** A game `hours` from now (negative: past), on the team, inserted directly. */
async function teamGame(teamId: string, hours: number, extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const { error } = await insertEvent({ id, team_id: teamId, event_type: "game", ...game(hours), ...extra });
  if (error) throw new Error(error.message);
  return id;
}

describe("a league", () => {
  it("a coach creates one; a teammate reads it; a player can't write it", async () => {
    const { coach, teamId } = await teamWithCoach();
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    const { id, error } = await league(coach.client, teamId);
    expect(error).toBeNull();

    const { data } = await player.client.from("leagues").select("name, season, archived_at").eq("id", id).single();
    expect(data).toEqual({ name: "Division 3", season: "Fall 2026", archived_at: null });

    expect((await league(player.client, teamId, "Rec", "Fall 2026")).error).not.toBeNull();
    await player.client.from("leagues").update({ name: "Renamed" }).eq("id", id);
    await player.client.from("leagues").delete().eq("id", id);
    const { data: still } = await adminClient.from("leagues").select("name").eq("id", id).single();
    expect(still?.name).toBe("Division 3");
  });

  it("someone off the team can't see it", async () => {
    const { coach, teamId } = await teamWithCoach();
    const { id } = await league(coach.client, teamId);
    const outsider = await createTestUser();

    const { data } = await outsider.client.from("leagues").select("id").eq("id", id);
    expect(data).toEqual([]);
  });

  it("needs a name and a season", async () => {
    const { coach, teamId } = await teamWithCoach();

    expect((await league(coach.client, teamId, "  ", "Fall 2026")).error).not.toBeNull();
    expect((await league(coach.client, teamId, "Division 3", "")).error).not.toBeNull();
  });

  it("D21: one per name and season on a team, whatever the case or spacing", async () => {
    const { coach, teamId } = await teamWithCoach();
    await league(coach.client, teamId, "Division 3", "Fall 2026");

    const duplicate = await league(coach.client, teamId, " division 3 ", "FALL 2026");
    expect(duplicate.error?.code).toBe("23505");

    // Next season's is another league; so is another team's.
    expect((await league(coach.client, teamId, "Division 3", "Spring 2027")).error).toBeNull();
    const other = await teamWithCoach();
    expect((await league(other.coach.client, other.teamId, "Division 3", "Fall 2026")).error).toBeNull();
  });

  it("stays on its team", async () => {
    const { coach, teamId } = await teamWithCoach();
    const { id } = await league(coach.client, teamId);
    const { teamId: otherTeam } = await createTestTeam(coach.user.id);

    const { error } = await coach.client.from("leagues").update({ team_id: otherTeam }).eq("id", id);
    expect(error?.message).toMatch(/LEAGUE_TEAM_FIXED/);
  });

  it("D17: archiving keeps its games' tags, and can be undone", async () => {
    const { coach, teamId } = await teamWithCoach();
    const { id } = await league(coach.client, teamId);
    const gameId = await teamGame(teamId, -48, { league_id: id, game_result: "win" });

    const { error } = await coach.client.from("leagues").update({ archived_at: new Date().toISOString() }).eq("id", id);
    expect(error).toBeNull();
    const { data: tagged } = await adminClient.from("events").select("league_id").eq("id", gameId).single();
    expect(tagged?.league_id).toBe(id);

    // And back.
    expect((await coach.client.from("leagues").update({ archived_at: null }).eq("id", id)).error).toBeNull();
  });
});

describe("D20: deleting a league", () => {
  it("one without games is deleted", async () => {
    const { coach, teamId } = await teamWithCoach();
    const { id } = await league(coach.client, teamId);

    const { error } = await coach.client.from("leagues").delete().eq("id", id);
    expect(error).toBeNull();
    const { data } = await adminClient.from("leagues").select("id").eq("id", id);
    expect(data).toEqual([]);
  });

  it("one with games is refused, pointing to archiving; once untagged it can go", async () => {
    const { coach, teamId } = await teamWithCoach();
    const { id } = await league(coach.client, teamId);
    const gameId = await teamGame(teamId, -48, { league_id: id });

    const { error } = await coach.client.from("leagues").delete().eq("id", id);
    expect(error?.message).toMatch(/LEAGUE_HAS_GAMES/);
    expect(error?.message).toMatch(/archive/i);

    await coach.client.from("events").update({ league_id: null }).eq("id", gameId);
    expect((await coach.client.from("leagues").delete().eq("id", id)).error).toBeNull();
  });

  it("deleting the team takes its leagues and tagged games with it", async () => {
    const { coach, teamId } = await teamWithCoach();
    const { id } = await league(coach.client, teamId);
    await teamGame(teamId, -48, { league_id: id });

    const { error } = await adminClient.from("teams").delete().eq("id", teamId);
    expect(error).toBeNull();
    const { data } = await adminClient.from("leagues").select("id").eq("id", id);
    expect(data).toEqual([]);
  });
});

describe("a game's league", () => {
  it("a coach tags a game, upcoming or played, and untags it", async () => {
    const { coach, teamId } = await teamWithCoach();
    const { id } = await league(coach.client, teamId);
    const played = await teamGame(teamId, -48, { game_result: "win" });
    const upcoming = await teamGame(teamId, 48);

    const { error } = await coach.client.from("events").update({ league_id: id }).in("id", [played, upcoming]);
    expect(error).toBeNull();
    const tagged = (await eventsOf(teamId)).filter((e) => e.league_id === id).map((e) => e.id);
    expect(tagged.sort()).toEqual([played, upcoming].sort());

    expect((await coach.client.from("events").update({ league_id: null }).eq("id", played)).error).toBeNull();
  });

  it("tagging notifies nobody, past games or upcoming", async () => {
    const { coach, teamId } = await teamWithCoach();
    const { id } = await league(coach.client, teamId);
    const played = await teamGame(teamId, -48);
    const upcoming = await teamGame(teamId, 48);

    await coach.client.from("events").update({ league_id: id }).in("id", [played, upcoming]);

    expect(await jobsOf(teamId)).toEqual([]);
  });

  it("only a game carries a league", async () => {
    const { coach, teamId } = await teamWithCoach();
    const { id } = await league(coach.client, teamId);
    const practice = crypto.randomUUID();
    await insertEvent({ id: practice, team_id: teamId, event_type: "practice", ...game(24), opponent: null, home_away: null });

    const { error } = await coach.client.from("events").update({ league_id: id }).eq("id", practice);
    expect(error).not.toBeNull();

    const tournamentId = await createTournament(coach, teamId, { games: [], notify: false });
    const { error: tournamentError } = await coach.client.from("events").update({ league_id: id }).eq("id", tournamentId);
    expect(tournamentError).not.toBeNull();
  });

  it("only a league of the game's own team", async () => {
    const { coach, teamId } = await teamWithCoach();
    const other = await teamWithCoach();
    const { id: theirs } = await league(other.coach.client, other.teamId);
    const gameId = await teamGame(teamId, 48);

    const { error } = await adminClient.from("events").update({ league_id: theirs }).eq("id", gameId);
    expect(error?.message).toMatch(/LEAGUE_TEAM_MISMATCH/);
  });

  it("a game keeps its team while it's in a league", async () => {
    const { coach, teamId } = await teamWithCoach();
    const { id } = await league(coach.client, teamId);
    const gameId = await teamGame(teamId, 48, { league_id: id });
    const { teamId: otherTeam } = await createTestTeam(coach.user.id);

    const { error } = await adminClient.from("events").update({ team_id: otherTeam }).eq("id", gameId);
    expect(error?.message).toMatch(/LEAGUE_TEAM_MISMATCH/);
  });

  it("D4: a tournament's game can be in a league too", async () => {
    const { coach, teamId } = await teamWithCoach();
    const { id } = await league(coach.client, teamId);
    const tournamentId = await createTournament(coach, teamId, { notify: false });
    const [first] = (await eventsOf(teamId)).filter((e) => e.tournament_id === tournamentId);

    const { error } = await coach.client.from("events").update({ league_id: id }).eq("id", first.id);
    expect(error).toBeNull();
  });
});

describe("a closed club's leagues", () => {
  it("are read-only", async () => {
    const owner = await createTestUser();
    const coach = await createTestUser();
    const { orgId, teamId } = await createTestTeam(owner.user.id);
    await addOrgMember(orgId, owner.user.id, "owner");
    await setOrgPlan(orgId, "club_small", "active");
    await addTeamMember(teamId, coach.user.id, "coach");
    const { id } = await league(coach.client, teamId);
    const { data: org } = await adminClient.from("organizations").select("name").eq("id", orgId).single();
    const closed = await adminClient.rpc("close_club", { p_actor_id: owner.user.id, p_org_id: orgId, p_confirm_name: org!.name });
    expect(closed.error).toBeNull();

    expect((await league(coach.client, teamId, "Rec", "Spring 2027")).error?.message).toMatch(/CLUB_CLOSED/);
    const { error } = await coach.client.from("leagues").update({ name: "Renamed" }).eq("id", id);
    expect(error?.message).toMatch(/CLUB_CLOSED/);
  });
});

