/**
 * What a schedule-change notice records (spec: docs/specs/email-upgrade.md §4.3, D11).
 *
 * The emails built from a notice show a game's opponent, home/away, uniform and
 * notes, and for an update what changed: the new time over the old one struck
 * through, and for a series "Tuesdays → Wednesdays". The job's snapshot is all
 * the worker has, so it now carries those fields, and an update carries the
 * event as it was in `previous`. A bulk series edit keeps one job whose
 * previous is the first occurrence's old state.
 */

import { describe, it, expect, afterAll } from "vitest";
import { adminClient, createTestUser, createTestTeam, cleanupTestData } from "./helpers";

afterAll(cleanupTestData);

type TestUser = Awaited<ReturnType<typeof createTestUser>>;
type Snapshot = Record<string, unknown> & { previous?: Record<string, unknown> | null };

const HOUR_MS = 60 * 60 * 1000;

async function createEvent(teamId: string, coach: TestUser, overrides: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const start = new Date(Date.now() + 48 * HOUR_MS);
  const { error } = await adminClient.from("events").insert({
    id,
    team_id: teamId,
    title: "Saturday game",
    event_type: "game",
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 90 * 60 * 1000).toISOString(),
    arrival_time: 15,
    opponent: "Rivals FC",
    home_away: "away",
    uniform: "home",
    notes: "Bring both jerseys.",
    created_by: coach.user.id,
    ...overrides,
  });
  if (error) throw new Error(error.message);
  return { id, start };
}

async function onlyJob(teamId: string) {
  const { data } = await adminClient.from("notification_jobs").select("*").eq("team_id", teamId);
  expect(data).toHaveLength(1);
  return data![0] as { action: string; occurrence_count: number; snapshot: Snapshot };
}

async function setup() {
  const coach = await createTestUser();
  const { teamId } = await createTestTeam(coach.user.id);
  return { coach, teamId };
}

describe("a notice's snapshot", () => {
  it("carries a game's opponent, home/away, uniform and notes", async () => {
    const { coach, teamId } = await setup();
    const { id } = await createEvent(teamId, coach);

    await coach.client.from("events").update({ is_cancelled: true }).eq("id", id);

    const { snapshot } = await onlyJob(teamId);
    expect(snapshot).toMatchObject({
      opponent: "Rivals FC",
      home_away: "away",
      uniform: "home",
      notes: "Bring both jerseys.",
    });
  });

  it("an update carries the event as it was, and as it is", async () => {
    const { coach, teamId } = await setup();
    const { id, start } = await createEvent(teamId, coach);
    const later = new Date(start.getTime() + HOUR_MS);

    await coach.client
      .from("events")
      .update({ start_time: later.toISOString(), end_time: new Date(later.getTime() + 90 * 60 * 1000).toISOString() })
      .eq("id", id);

    const { action, snapshot } = await onlyJob(teamId);
    expect(action).toBe("updated");
    expect(new Date(snapshot.start_time as string).getTime()).toBe(later.getTime());
    expect(new Date(snapshot.previous!.start_time as string).getTime()).toBe(start.getTime());
    expect(snapshot.previous).toMatchObject({ arrival_time: 15, opponent: "Rivals FC" });
  });

  it("a bulk series edit carries the first occurrence's previous state", async () => {
    const { coach, teamId } = await setup();
    const ids = [] as string[];
    for (let i = 0; i < 3; i++) ids.push((await createEvent(teamId, coach, { event_type: "practice", title: "Tuesday practice" })).id);

    await coach.client.from("events").update({ arrival_time: 30 }).in("id", ids);

    const { occurrence_count, snapshot } = await onlyJob(teamId);
    expect(occurrence_count).toBe(3);
    expect(snapshot.arrival_time).toBe(30);
    expect(snapshot.previous).toMatchObject({ arrival_time: 15 });
  });

  it("a cancellation carries no previous version", async () => {
    const { coach, teamId } = await setup();
    const { id } = await createEvent(teamId, coach);

    await coach.client.from("events").update({ is_cancelled: true }).eq("id", id);

    const { snapshot } = await onlyJob(teamId);
    expect(snapshot.previous ?? null).toBeNull();
  });
});
