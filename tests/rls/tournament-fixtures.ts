/**
 * Shared fixtures for the tournament tests (tournaments.test.ts and
 * tournaments-review.test.ts). Tournaments are in America/Los_Angeles.
 */

import { adminClient, createTestUser, createTestTeam } from "./helpers";

export type TestUser = Awaited<ReturnType<typeof createTestUser>>;

export const ZONE = "America/Los_Angeles";
export const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD in the tournament's zone, `days` from today. */
export function day(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, dateStyle: "short" }).format(
    new Date(Date.now() + days * DAY_MS)
  );
}

/** "YYYY-MM-DD HH:mm" of an instant, in the tournament's zone. */
export function local(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** A game `hours` from now, 90 minutes long. */
export function game(hours: number, extra: Record<string, unknown> = {}) {
  const start = new Date(Date.now() + hours * 60 * 60 * 1000);
  return {
    title: "Game",
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 90 * 60 * 1000).toISOString(),
    opponent: "Rivals FC",
    home_away: "home",
    ...extra,
  };
}

export async function teamWithCoach() {
  const coach = await createTestUser();
  const { teamId } = await createTestTeam(coach.user.id);
  await adminClient.from("teams").update({ timezone: ZONE }).eq("id", teamId);
  return { coach, teamId };
}

export async function createTournament(
  coach: TestUser,
  teamId: string,
  opts: { firstDay?: string; lastDay?: string; games?: unknown[]; notify?: boolean } = {}
) {
  const { data, error } = await coach.client.rpc("create_tournament", {
    p_team_id: teamId,
    p_title: "Surf Cup",
    p_first_day: opts.firstDay ?? day(10),
    p_last_day: opts.lastDay ?? day(12),
    p_games: opts.games ?? [game(10 * 24 + 2, { round: "Pool A" }), game(11 * 24 + 2, { round: "Semifinal" })],
    p_notify: opts.notify ?? true,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function eventsOf(teamId: string) {
  const { data } = await adminClient.from("events").select("*").eq("team_id", teamId).order("start_time");
  return data ?? [];
}

export async function jobsOf(teamId: string) {
  const { data } = await adminClient.from("notification_jobs").select("*").eq("team_id", teamId).order("created_at");
  return data ?? [];
}

export async function insertEvent(row: Record<string, unknown>) {
  return adminClient.from("events").insert({ id: crypto.randomUUID(), title: "Event", ...row });
}
