/**
 * Event-level timezones in the database (BUG-010, decision D5).
 *
 * Events now carry a named zone, `events.timezone`:
 *   - an event created without one takes the team's zone at that moment, and a
 *     team with no zone leaves it unset, as the backfill does
 *   - a name Postgres cannot resolve is refused, whoever writes it
 *   - changing the team's zone afterwards leaves existing events alone
 *   - recording a zone never moves the stored instants
 *   - a zone change is a schedule change: it enqueues an "updated" notice, and
 *     every notice's snapshot names the zone
 *   - a series edit gives new occurrences the series' zone, and can change it
 *
 * Plans come from the real planner, with the zone passed explicitly. The process
 * zone is pinned to Tokyo so nothing here can lean on the device's zone.
 */

import { vi, describe, it, expect, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.TZ = "Asia/Tokyo";
});

import { buildRRule, untilEndOfDay } from "@/lib/utils/rrule";
import { planSeriesEdit } from "@/lib/events/series-edit";
import { instantFromWallClock, wallClockIn } from "@/lib/events/event-timezone";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const PACIFIC = "America/Los_Angeles";
const DENVER = "America/Denver";
const DAY_MS = 24 * 60 * 60 * 1000;

async function setup(teamZone: string | null = PACIFIC) {
  const coach = await createTestUser();
  const { teamId } = await createTestTeam(coach.user.id);
  if (teamZone) {
    const { error } = await adminClient.from("teams").update({ timezone: teamZone }).eq("id", teamId);
    if (error) throw new Error(error.message);
  }
  return { coach, teamId };
}

/** An upcoming 4:00–5:30 PM event, `days` from now, inserted by the coach. */
async function createEvent(
  teamId: string,
  coach: TestUser,
  overrides: Record<string, unknown> = {},
  days = 3
) {
  const id = crypto.randomUUID();
  const start = new Date(Date.now() + days * DAY_MS);
  const { error } = await coach.client.from("events").insert({
    id,
    team_id: teamId,
    title: "Practice",
    event_type: "practice",
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 90 * 60 * 1000).toISOString(),
    created_by: coach.user.id,
    ...overrides,
  });
  return { id, error, start };
}

async function eventById(id: string) {
  const { data } = await adminClient.from("events").select("*").eq("id", id).single();
  return data!;
}

async function jobsFor(teamId: string) {
  const { data } = await adminClient
    .from("notification_jobs")
    .select("*")
    .eq("team_id", teamId)
    .order("created_at");
  return data ?? [];
}

describe("the zone an event is created with", () => {
  it("defaults to the team's zone", async () => {
    const { coach, teamId } = await setup(PACIFIC);
    const { id, error } = await createEvent(teamId, coach);

    expect(error).toBeNull();
    expect((await eventById(id)).timezone).toBe(PACIFIC);
  });

  it("keeps an explicit override for an event somewhere else", async () => {
    const { coach, teamId } = await setup(PACIFIC);
    const { id, error } = await createEvent(teamId, coach, { timezone: DENVER });

    expect(error).toBeNull();
    expect((await eventById(id)).timezone).toBe(DENVER);
  });

  it("stays unset when the team has no zone either", async () => {
    const { coach, teamId } = await setup(null);
    const { id, error } = await createEvent(teamId, coach);

    expect(error).toBeNull();
    expect((await eventById(id)).timezone).toBeNull();
  });

  it("refuses a zone Postgres cannot resolve, on insert and on update", async () => {
    const { coach, teamId } = await setup(PACIFIC);

    const { error: insertError } = await createEvent(teamId, coach, { timezone: "Pacific Time" });
    expect(insertError?.message).toMatch(/INVALID_TIMEZONE/);

    const { id } = await createEvent(teamId, coach);
    const { error: updateError } = await coach.client
      .from("events")
      .update({ timezone: "Mars/Olympus_Mons" })
      .eq("id", id);
    expect(updateError?.message).toMatch(/INVALID_TIMEZONE/);
    expect((await eventById(id)).timezone).toBe(PACIFIC);
  });
});

describe("what a zone never changes", () => {
  it("changing the team's zone does not shift or relabel existing events", async () => {
    const { coach, teamId } = await setup(PACIFIC);
    const { id } = await createEvent(teamId, coach);
    const before = await eventById(id);

    const { error } = await adminClient.from("teams").update({ timezone: "America/New_York" }).eq("id", teamId);
    expect(error).toBeNull();

    const after = await eventById(id);
    expect(after.timezone).toBe(PACIFIC);
    expect(after.start_time).toBe(before.start_time);
    expect(after.end_time).toBe(before.end_time);
  });

  it("recording a zone on an event that had none keeps its stored instants, as the backfill does", async () => {
    const { coach, teamId } = await setup(null);
    const { id } = await createEvent(teamId, coach);
    const before = await eventById(id);

    const { error } = await adminClient.from("events").update({ timezone: PACIFIC }).eq("id", id);
    expect(error).toBeNull();

    const after = await eventById(id);
    expect(after.timezone).toBe(PACIFIC);
    expect(after.start_time).toBe(before.start_time);
    expect(after.end_time).toBe(before.end_time);
  });
});

describe("notifications name the zone (D3)", () => {
  it("moving an event to another zone enqueues an 'updated' notice", async () => {
    const { coach, teamId } = await setup(PACIFIC);
    const { id, start } = await createEvent(teamId, coach);
    // Same local clock time in Denver: one hour earlier.
    const moved = new Date(start.getTime() - 60 * 60 * 1000);

    const { error } = await coach.client
      .from("events")
      .update({ timezone: DENVER, start_time: moved.toISOString() })
      .eq("id", id);
    expect(error).toBeNull();

    const jobs = await jobsFor(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].action).toBe("updated");
    expect((jobs[0].snapshot as { timezone: string }).timezone).toBe(DENVER);
  });

  it("relabelling the zone alone is a schedule change too", async () => {
    const { coach, teamId } = await setup(PACIFIC);
    const { id } = await createEvent(teamId, coach);

    const { error } = await coach.client.from("events").update({ timezone: DENVER }).eq("id", id);
    expect(error).toBeNull();

    const jobs = await jobsFor(teamId);
    expect(jobs.map((j) => j.action)).toEqual(["updated"]);
  });

  it("a created-event notice carries the zone", async () => {
    const { coach, teamId } = await setup(PACIFIC);
    const { id } = await createEvent(teamId, coach, { timezone: DENVER });

    const { error } = await coach.client.rpc("enqueue_event_notification", {
      p_event_id: id,
      p_action: "created",
    });
    expect(error).toBeNull();

    const [job] = await jobsFor(teamId);
    expect((job.snapshot as { timezone: string }).timezone).toBe(DENVER);
  });
});

describe("series edits keep and change the series' zone", () => {
  /** A weekly 4 PM series in `zone`, four upcoming occurrences, created as the form does. */
  async function denverSeries(teamId: string, coach: TestUser) {
    const first = new Date(Date.now() + 2 * DAY_MS);
    const firstWall = `${wallClockIn(first, DENVER).slice(0, 10)}T16:00`;
    const lastDate = wallClockIn(new Date(first.getTime() + 21 * DAY_MS), DENVER).slice(0, 10);
    const rule = buildRRule({
      frequency: "weekly",
      daysOfWeek: [(new Date(`${firstWall.slice(0, 10)}T00:00:00Z`).getUTCDay() + 6) % 7],
      until: untilEndOfDay(lastDate),
      dtstart: new Date(`${firstWall}:00.000Z`),
    });
    const headId = crypto.randomUUID();
    const rows = [0, 1, 2, 3].map((week) => {
      const wall = `${wallClockIn(new Date(first.getTime() + week * 7 * DAY_MS), DENVER).slice(0, 10)}T16:00`;
      const start = instantFromWallClock(wall, DENVER);
      return {
        id: week === 0 ? headId : crypto.randomUUID(),
        team_id: teamId,
        title: "Practice",
        event_type: "practice",
        start_time: start.toISOString(),
        end_time: new Date(start.getTime() + 90 * 60 * 1000).toISOString(),
        timezone: DENVER,
        recurrence_rule: week === 0 ? rule : null,
        parent_event_id: week === 0 ? null : headId,
        created_by: coach.user.id,
      };
    });
    const { error: headError } = await coach.client.from("events").insert(rows[0]);
    if (headError) throw new Error(headError.message);
    const { error } = await coach.client.from("events").insert(rows.slice(1));
    if (error) throw new Error(error.message);
    return { headId, lastDate };
  }

  async function occurrences(headId: string) {
    const { data } = await adminClient
      .from("events")
      .select("*")
      .or(`id.eq.${headId},parent_event_id.eq.${headId}`)
      .order("start_time");
    return data ?? [];
  }

  it("new occurrences take the series' zone, not the team's", async () => {
    const { coach, teamId } = await setup(PACIFIC);
    const { headId, lastDate } = await denverSeries(teamId, coach);
    const rows = await occurrences(headId);
    const extendTo = wallClockIn(new Date(new Date(`${lastDate}T12:00:00Z`).getTime() + 14 * DAY_MS), DENVER).slice(0, 10);

    const plan = planSeriesEdit({
      occurrences: rows,
      openedId: headId,
      scope: "series",
      now: new Date(),
      fields: {},
      timeZone: DENVER,
      pattern: {
        frequency: "weekly",
        daysOfWeek: [(new Date(`${lastDate}T00:00:00Z`).getUTCDay() + 6) % 7],
        untilDate: extendTo,
      },
    });
    expect(plan.inserts.length).toBeGreaterThan(0);

    const { error } = await coach.client.rpc("apply_series_edit", { p_series_head_id: headId, p_plan: plan });
    expect(error).toBeNull();

    for (const insert of plan.inserts) {
      const row = await eventById(insert.id);
      expect(row.timezone).toBe(DENVER);
      expect(wallClockIn(row.start_time, DENVER).slice(11)).toBe("16:00");
    }
  });

  it("changing the series' zone moves upcoming occurrences to the same local time there", async () => {
    const { coach, teamId } = await setup(PACIFIC);
    const { headId } = await denverSeries(teamId, coach);
    const rows = await occurrences(headId);

    const plan = planSeriesEdit({
      occurrences: rows,
      openedId: headId,
      scope: "series",
      now: new Date(),
      fields: {},
      timeZone: DENVER,
      newTimeZone: PACIFIC,
    });

    const { error } = await coach.client.rpc("apply_series_edit", { p_series_head_id: headId, p_plan: plan });
    expect(error).toBeNull();

    const after = await occurrences(headId);
    expect(after.map((r) => r.timezone)).toEqual(after.map(() => PACIFIC));
    expect(after.map((r) => wallClockIn(r.start_time, PACIFIC).slice(11))).toEqual(after.map(() => "16:00"));
    // Same rows, same ids: nothing was deleted and re-created.
    expect(after.map((r) => r.id).sort()).toEqual(rows.map((r) => r.id).sort());
  });
});
