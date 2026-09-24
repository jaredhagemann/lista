/**
 * Recurring series in the database (BUG-009, decision D4).
 *
 *   - deleting the first occurrence (the series head) must not delete the rest:
 *     `events.parent_event_id` used to be ON DELETE CASCADE
 *   - delete_event_occurrence removes one occurrence, promoting the next one to
 *     head when needed; delete_event_series is the explicit whole-series delete
 *   - apply_series_edit applies a planSeriesEdit plan in one transaction: ids,
 *     availability and past events survive, dropped dates are cancelled rather
 *     than deleted, and a bad plan changes nothing
 *
 * Plans are produced by the real planner, in the series' zone: Pacific, the same
 * zone the process is pinned to, so the fixtures' device-local times match it.
 */

import { vi, describe, it, expect, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.TZ = "America/Los_Angeles";
});

import { buildRRule, untilEndOfDay } from "@/lib/utils/rrule";
import { planSeriesEdit, pinnedStartRule, type SeriesEditPlan } from "@/lib/events/series-edit";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

// ── Fixtures ──────────────────────────────────────────────────────────────────

type TestUser = Awaited<ReturnType<typeof createTestUser>>;
type EventRow = Awaited<ReturnType<typeof seriesRows>>[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const PACIFIC = "America/Los_Angeles";
const pad = (n: number) => String(n).padStart(2, "0");
const wall = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * A weekly 4:00–5:30 PM series of 8 occurrences: 3 in the past, 5 upcoming.
 * The first occurrence is the head.
 */
async function createSeries(teamId: string, coach: TestUser) {
  const firstDay = new Date(Date.now() - 3 * 7 * DAY_MS + DAY_MS);
  firstDay.setHours(16, 0, 0, 0);
  const starts = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(firstDay);
    d.setDate(d.getDate() + i * 7);
    return d;
  });
  const rule = buildRRule({
    frequency: "weekly",
    daysOfWeek: [(firstDay.getDay() + 6) % 7],
    dtstart: new Date(`${wall(starts[0])}:00.000Z`),
    until: untilEndOfDay(wall(starts[7]).slice(0, 10)),
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
    location_id: null,
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

async function eventById(id: string) {
  const { data } = await adminClient.from("events").select("*").eq("id", id).maybeSingle();
  return data;
}

async function setup() {
  const coach = await createTestUser();
  const player = await createTestUser();
  const { teamId } = await createTestTeam(coach.user.id);
  await addTeamMember(teamId, player.user.id, "player");
  const ids = await createSeries(teamId, coach);
  return { coach, player, teamId, ids };
}

async function respond(eventId: string, player: TestUser) {
  const { error } = await adminClient
    .from("availability")
    .insert({ event_id: eventId, profile_id: player.user.id, status: "available" });
  if (error) throw new Error(error.message);
}

async function availabilityFor(eventId: string) {
  const { data } = await adminClient.from("availability").select("status").eq("event_id", eventId);
  return data ?? [];
}

function applyPlan(client: TestUser["client"], plan: SeriesEditPlan) {
  return client.rpc("apply_series_edit", { p_series_head_id: plan.seriesHeadId, p_plan: plan });
}

// ── Deleting ──────────────────────────────────────────────────────────────────

describe("deleting occurrences of a series (BUG-009)", () => {
  it("deleting the series head directly does not delete the other occurrences", async () => {
    const { coach, ids } = await setup();

    await coach.client.from("events").delete().eq("id", ids[0]);

    const remaining = await seriesRows(ids.slice(1));
    expect(remaining).toHaveLength(7);
  });

  it("delete_event_occurrence on the head promotes the next occurrence and keeps everything else", async () => {
    const { coach, player, ids } = await setup();
    await respond(ids[4], player);
    const head = (await eventById(ids[0]))!;
    const rule = pinnedStartRule(head, PACIFIC);

    const { error } = await coach.client.rpc("delete_event_occurrence", {
      p_event_id: ids[0],
      p_promoted_head_rule: rule,
    });
    expect(error).toBeNull();

    expect(await eventById(ids[0])).toBeNull();
    const promoted = (await eventById(ids[1]))!;
    expect(promoted.parent_event_id).toBeNull();
    expect(promoted.recurrence_rule).toBe(rule);
    const rest = await seriesRows(ids.slice(2));
    expect(rest).toHaveLength(6);
    expect(rest.every((r) => r.parent_event_id === ids[1])).toBe(true);
    expect(await availabilityFor(ids[4])).toEqual([{ status: "available" }]);
  });

  it("delete_event_occurrence on another occurrence deletes only that one", async () => {
    const { coach, ids } = await setup();

    const { error } = await coach.client.rpc("delete_event_occurrence", { p_event_id: ids[5] });
    expect(error).toBeNull();

    expect(await eventById(ids[5])).toBeNull();
    expect(await seriesRows(ids.filter((id) => id !== ids[5]))).toHaveLength(7);
  });

  it("a non-admin cannot delete an occurrence", async () => {
    const { player, ids } = await setup();

    const { error } = await player.client.rpc("delete_event_occurrence", { p_event_id: ids[5] });
    expect(error).not.toBeNull();
    expect(await eventById(ids[5])).not.toBeNull();
  });

  it("delete_event_series deletes every occurrence, as an explicit action", async () => {
    const { coach, ids } = await setup();

    const { data, error } = await coach.client.rpc("delete_event_series", { p_event_id: ids[3] });
    expect(error).toBeNull();
    expect(data).toBe(8);
    expect(await seriesRows(ids)).toHaveLength(0);
  });

  it("deleting the team still removes its series", async () => {
    const { teamId, ids } = await setup();

    const { error } = await adminClient.from("teams").delete().eq("id", teamId);
    expect(error).toBeNull();
    expect(await seriesRows(ids)).toHaveLength(0);
  });

  it("a non-admin cannot delete a series", async () => {
    const { player, ids } = await setup();

    const { error } = await player.client.rpc("delete_event_series", { p_event_id: ids[0] });
    expect(error).not.toBeNull();
    expect(await seriesRows(ids)).toHaveLength(8);
  });
});

// ── Editing ───────────────────────────────────────────────────────────────────

describe("apply_series_edit (BUG-009, D4)", () => {
  function plan(rows: EventRow[], args: Partial<Parameters<typeof planSeriesEdit>[0]>) {
    return planSeriesEdit({
      occurrences: rows,
      openedId: rows[3].id,
      scope: "series",
      now: new Date(),
      fields: {},
      timeZone: PACIFIC,
      ...args,
    });
  }

  it("a venue and time change keeps ids and availability, and leaves past events untouched", async () => {
    const { coach, player, ids, teamId } = await setup();
    await respond(ids[1], player); // past
    await respond(ids[5], player); // upcoming
    const { data: location } = await adminClient
      .from("locations")
      .insert({ id: crypto.randomUUID(), team_id: teamId, name: "New Field" })
      .select("id")
      .single();
    const before = await seriesRows(ids);
    const p = plan(before, { fields: { location_id: location!.id }, time: { start: "17:00", end: "18:30" } });

    const { data, error } = await applyPlan(coach.client, p);
    expect(error).toBeNull();
    expect(data).toBe(ids[3]);

    const after = await seriesRows(ids);
    expect(after.map((r) => r.id)).toEqual(ids);
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3).map((r, i) => (i === 0 ? { ...r, recurrence_rule: p.truncateRule } : r)));
    for (const row of after.slice(3)) {
      expect(row.location_id).toBe(location!.id);
      expect(new Date(row.start_time).getHours()).toBe(17);
    }
    expect(after[3].parent_event_id).toBeNull();
    expect(after[3].recurrence_rule).toBe(p.newHeadRule);
    expect(after.slice(4).every((r) => r.parent_event_id === ids[3])).toBe(true);
    expect(await availabilityFor(ids[1])).toHaveLength(1);
    expect(await availabilityFor(ids[5])).toEqual([{ status: "available" }]);
  });

  it("shortening cancels dropped occurrences instead of deleting them, and extending adds new ones", async () => {
    const { coach, player, ids } = await setup();
    await respond(ids[7], player);
    const before = await seriesRows(ids);
    const lastDate = (i: number) => wall(new Date(before[i].start_time)).slice(0, 10);
    const weekday = (new Date(before[0].start_time).getDay() + 6) % 7;

    const shorter = plan(before, { pattern: { frequency: "weekly", daysOfWeek: [weekday], untilDate: lastDate(5) } });
    expect((await applyPlan(coach.client, shorter)).error).toBeNull();
    const cancelled = await seriesRows([ids[6], ids[7]]);
    expect(cancelled.map((r) => r.is_cancelled)).toEqual([true, true]);
    expect(await availabilityFor(ids[7])).toEqual([{ status: "available" }]);

    const afterShort = await seriesRows(ids);
    const extendUntil = wall(new Date(new Date(before[7].start_time).getTime() + 14 * DAY_MS)).slice(0, 10);
    const longer = plan(afterShort, {
      pattern: { frequency: "weekly", daysOfWeek: [weekday], untilDate: extendUntil },
    });
    expect(longer.inserts).toHaveLength(2);
    expect((await applyPlan(coach.client, longer)).error).toBeNull();
    for (const insert of longer.inserts) {
      const row = (await eventById(insert.id))!;
      expect(row.parent_event_id).toBe(longer.newHeadId);
      expect(row.created_by).toBe(coach.user.id);
      expect(await availabilityFor(insert.id)).toHaveLength(0);
    }
  });

  it("refuses a plan that touches an event outside the series, and changes nothing", async () => {
    const { coach, ids, teamId } = await setup();
    const otherIds = await createSeries(teamId, coach);
    const before = await seriesRows(ids);
    const p = plan(before, { fields: { notes: "Should not apply" } });
    p.updates.push({ id: otherIds[5], fields: { notes: "Hijacked" } });

    const { error } = await applyPlan(coach.client, p);
    expect(error).not.toBeNull();

    expect((await seriesRows(ids)).map((r) => r.notes)).toEqual(before.map((r) => r.notes));
    expect((await eventById(otherIds[5]))!.notes).toBeNull();
  });

  it("a non-admin cannot apply a series edit", async () => {
    const { player, ids } = await setup();
    const before = await seriesRows(ids);
    const p = plan(before, { fields: { notes: "Player edit" } });

    const { error } = await applyPlan(player.client, p);
    expect(error).not.toBeNull();
    expect((await seriesRows(ids)).every((r) => r.notes === null)).toBe(true);
  });
});
