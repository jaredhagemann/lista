/**
 * What the notice senders read for tournaments, run against the database
 * (docs/specs/tournaments-and-leagues.md §4, "Notifications"; part 2c).
 *
 * The senders are tested with the database mocked. These check that the
 * queries they send resolve: the reminder cron's select, with a game's
 * tournament embedded, and the tournament's games. An embed PostgREST can't
 * resolve fails the whole reminder run.
 */

import { describe, it, expect, afterAll } from "vitest";
import { adminClient, cleanupTestData } from "./helpers";
import { createTournament, day, eventsOf, jobsOf, teamWithCoach } from "./tournament-fixtures";
import {
  REMINDER_EVENT_COLUMNS,
  REMINDER_TOURNAMENT_GAME_COLUMNS,
} from "@/lib/notifications/tournament-notice";

afterAll(cleanupTestData);

describe("the reminder cron's reads", () => {
  it("embeds a game's tournament, and none for the tournament itself", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { notify: false });

    const { data, error } = await adminClient
      .from("events")
      .select(REMINDER_EVENT_COLUMNS)
      .eq("team_id", teamId)
      .order("start_time");

    expect(error).toBeNull();
    const rows = data as unknown as { id: string; tournament_id: string | null; round: string | null; tournament: { title: string } | null }[];
    expect(rows.find((r) => r.id === id)!.tournament).toBeNull();
    const games = rows.filter((r) => r.tournament_id === id);
    expect(games.map((g) => [g.tournament?.title, g.round])).toEqual([
      ["Surf Cup", "Pool A"],
      ["Surf Cup", "Semifinal"],
    ]);
  });

  it("lists a tournament's games, in order", async () => {
    const { coach, teamId } = await teamWithCoach();
    const id = await createTournament(coach, teamId, { notify: false });

    const { data, error } = await adminClient
      .from("events")
      .select(REMINDER_TOURNAMENT_GAME_COLUMNS)
      .eq("tournament_id", id)
      .order("start_time", { ascending: true });

    expect(error).toBeNull();
    expect((data ?? []).map((g) => g.round)).toEqual(["Pool A", "Semifinal"]);
  });
});

describe("what a tournament job carries for its template", () => {
  it("its games, each with what the email lists", async () => {
    const { coach, teamId } = await teamWithCoach();
    await createTournament(coach, teamId, { firstDay: day(10), lastDay: day(12) });

    const [job] = await jobsOf(teamId);
    const games = (await eventsOf(teamId)).filter((e) => e.event_type === "game");
    expect(job.snapshot.event_type).toBe("tournament");
    expect(job.snapshot.tournament.games_action).toBe("created");
    expect(job.snapshot.tournament.affected_games).toEqual(
      games.map((g) =>
        expect.objectContaining({ id: g.id, round: g.round, opponent: g.opponent, timezone: g.timezone })
      )
    );
  });
});
