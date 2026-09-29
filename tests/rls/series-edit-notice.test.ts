/**
 * A series edit is one notice (PR #96 review, P2).
 *
 * apply_series_edit moves a series to another day by cancelling the old
 * occurrences and adding new ones. The change trigger saw only the
 * cancellations (inserts don't fire it), so families were told
 * "Cancelled: Practice — 3 events" and nothing about the new days. Now the
 * operation's own rows enqueue nothing; it enqueues one 'updated' notice for
 * the series, carrying the editor's summary of what changed (series_changes)
 * and counting the upcoming events it affects.
 */

import { vi, describe, it, expect, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.TZ = "America/Los_Angeles";
});

import { buildRRule, untilEndOfDay } from "@/lib/utils/rrule";
import { planSeriesEdit, type SeriesEditPlan } from "@/lib/events/series-edit";
import { adminClient, createTestUser, createTestTeam, cleanupTestData } from "./helpers";

afterAll(cleanupTestData);

type TestUser = Awaited<ReturnType<typeof createTestUser>>;
type EventRow = Awaited<ReturnType<typeof seriesRows>>[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const PACIFIC = "America/Los_Angeles";
const pad = (n: number) => String(n).padStart(2, "0");
const wall = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** A weekly 4:00–5:30 PM series of 6 occurrences, all upcoming. The first is the head. */
async function createSeries(teamId: string, coach: TestUser) {
  const firstDay = new Date(Date.now() + 2 * DAY_MS);
  firstDay.setHours(16, 0, 0, 0);
  const starts = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(firstDay);
    d.setDate(d.getDate() + i * 7);
    return d;
  });
  const rule = buildRRule({
    frequency: "weekly",
    daysOfWeek: [(firstDay.getDay() + 6) % 7],
    dtstart: new Date(`${wall(starts[0])}:00.000Z`),
    until: untilEndOfDay(wall(starts[5]).slice(0, 10)),
  });
  const headId = crypto.randomUUID();
  const rows = starts.map((start, i) => ({
    id: i === 0 ? headId : crypto.randomUUID(),
    team_id: teamId,
    title: "Practice",
    event_type: "practice",
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 90 * 60 * 1000).toISOString(),
    recurrence_rule: i === 0 ? rule : null,
    parent_event_id: i === 0 ? null : headId,
    created_by: coach.user.id,
    arrival_time: 15,
  }));
  const { error: headError } = await adminClient.from("events").insert(rows[0]);
  if (headError) throw new Error(headError.message);
  const { error } = await adminClient.from("events").insert(rows.slice(1));
  if (error) throw new Error(error.message);
  return rows.map((r) => r.id);
}

async function seriesRows(ids: string[]) {
  const { data } = await adminClient.from("events").select("*").in("id", ids).order("start_time");
  return data ?? [];
}

async function jobsFor(teamId: string) {
  const { data } = await adminClient.from("notification_jobs").select("*").eq("team_id", teamId);
  return (data ?? []) as Array<{ action: string; occurrence_count: number; snapshot: Record<string, unknown> }>;
}

async function setup() {
  const coach = await createTestUser();
  const { teamId } = await createTestTeam(coach.user.id);
  const ids = await createSeries(teamId, coach);
  return { coach, teamId, ids };
}

function plan(rows: EventRow[], args: Partial<Parameters<typeof planSeriesEdit>[0]>): SeriesEditPlan {
  return planSeriesEdit({
    occurrences: rows,
    openedId: rows[0].id,
    scope: "series",
    now: new Date(),
    fields: {},
    timeZone: PACIFIC,
    ...args,
  });
}

function apply(coach: TestUser, p: SeriesEditPlan) {
  return coach.client.rpc("apply_series_edit", { p_series_head_id: p.seriesHeadId, p_plan: p });
}

const SUMMARY = [{ field: "Recurrence", before: "Every week on Tuesday", after: "Every week on Wednesday" }];

describe("a series edit's notice", () => {
  it("moving to another day is one 'updated' notice with what changed, not a cancellation", async () => {
    const { coach, teamId, ids } = await setup();
    const before = await seriesRows(ids);
    const weekday = (new Date(before[0].start_time).getDay() + 6) % 7;
    const p = plan(before, {
      pattern: { frequency: "weekly", daysOfWeek: [(weekday + 1) % 7], untilDate: wall(new Date(before[5].start_time)).slice(0, 10) },
    });
    expect(p.cancels.length).toBeGreaterThan(0);
    expect(p.inserts.length).toBeGreaterThan(0);

    expect((await apply(coach, { ...p, summary: SUMMARY })).error).toBeNull();

    const jobs = await jobsFor(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].action).toBe("updated");
    expect(jobs[0].snapshot.series_changes).toEqual(SUMMARY);
    expect(jobs[0].occurrence_count).toBe(p.inserts.length + p.updates.length);
  });

  it("a time change is one notice too, counting the events it moved", async () => {
    const { coach, teamId, ids } = await setup();
    const p = plan(await seriesRows(ids), { time: { start: "17:00", end: "18:30" } });
    const summary = [{ field: "Time", before: "4:00 PM – 5:30 PM PDT", after: "5:00 PM – 6:30 PM PDT" }];

    expect((await apply(coach, { ...p, summary })).error).toBeNull();

    const jobs = await jobsFor(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].snapshot.series_changes).toEqual(summary);
    expect(jobs[0].occurrence_count).toBe(6);
  });

  it("without a summary (an older client), still one notice, with no changes listed", async () => {
    const { coach, teamId, ids } = await setup();
    const p = plan(await seriesRows(ids), { time: { start: "17:00", end: "18:30" } });

    expect((await apply(coach, p)).error).toBeNull();

    const jobs = await jobsFor(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].snapshot.series_changes).toEqual([]);
  });

  it("keeps only well-formed rows of the summary, capped in number and length", async () => {
    const { coach, teamId, ids } = await setup();
    const p = plan(await seriesRows(ids), { time: { start: "17:00", end: "18:30" } });
    const summary = [
      { field: "Time", before: "x".repeat(500), after: "5:00 PM", extra: "dropped" },
      { field: 42, before: "not a string field" },
      ...Array.from({ length: 20 }, (_, i) => ({ field: `F${i}`, before: "a", after: "b" })),
    ];

    expect((await apply(coach, { ...p, summary } as unknown as SeriesEditPlan)).error).toBeNull();

    const changes = (await jobsFor(teamId))[0].snapshot.series_changes as Array<Record<string, string>>;
    expect(changes).toHaveLength(12);
    expect(changes[0]).toEqual({ field: "Time", before: "x".repeat(200), after: "5:00 PM" });
    expect(changes.some((c) => c.before === "not a string field")).toBe(false);
  });

  it("afterwards, an ordinary change notifies as before", async () => {
    const { coach, teamId, ids } = await setup();
    const p = plan(await seriesRows(ids), { time: { start: "17:00", end: "18:30" } });
    expect((await apply(coach, { ...p, summary: SUMMARY })).error).toBeNull();

    await coach.client.from("events").update({ arrival_time: 30 }).eq("id", ids[2]);

    const actions = (await jobsFor(teamId)).map((j) => j.action).sort();
    expect(actions).toEqual(["updated", "updated"]);
  });

  it("nobody can enqueue a series notice outside a series edit", async () => {
    const { coach, ids } = await setup();

    const { error } = await coach.client.rpc("enqueue_series_edit_notice", {
      p_series_head: ids[0],
      p_summary: SUMMARY,
      p_count: 3,
    });

    expect(error).not.toBeNull();
  });
});
