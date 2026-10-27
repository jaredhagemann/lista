/**
 * Coach reminder controls (docs/specs/team-notification-controls.md §4).
 *
 * A team's reminder settings are read by its members and written by whoever
 * can edit its events: coaches, managers and club directors (D5, revised
 * 2026-10-26). An event's own `reminder` follows the event policies.
 *
 * Changing a reminder setting tells the team nothing (D13): not on one event,
 * not across a series, not in the team's settings. And the reminders job's
 * own log rows are never picked up by the notice worker.
 */

import { vi, describe, it, expect, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.TZ = "America/Los_Angeles";
});

import { buildRRule, untilEndOfDay } from "@/lib/utils/rrule";
import { planSeriesEdit, type SeriesEditPlan } from "@/lib/events/series-edit";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  addOrgMember,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");
const wall = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function setup() {
  const coach = await createTestUser();
  const { teamId, orgId } = await createTestTeam(coach.user.id);
  return { coach, teamId, orgId };
}

async function memberOf(teamId: string, role: "manager" | "parent" | "player") {
  const user = await createTestUser();
  await addTeamMember(teamId, user.user.id, role);
  return user;
}

const SETTINGS = { enabled: false, remind_practice: true, remind_game: false, remind_other: true, remind_tournament: true };

function writeSettings(user: TestUser, teamId: string, values: Partial<typeof SETTINGS> = SETTINGS) {
  return user.client.from("team_reminder_settings").upsert({ team_id: teamId, ...values }, { onConflict: "team_id" });
}

async function settingsRow(teamId: string) {
  const { data } = await adminClient.from("team_reminder_settings").select("*").eq("team_id", teamId).maybeSingle();
  return data;
}

async function createEvent(teamId: string, coach: TestUser, overrides: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const start = new Date(Date.now() + 2 * DAY_MS);
  const { error } = await adminClient.from("events").insert({
    id,
    team_id: teamId,
    title: "Practice",
    event_type: "practice",
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 90 * 60 * 1000).toISOString(),
    created_by: coach.user.id,
    ...overrides,
  });
  if (error) throw new Error(error.message);
  return id;
}

async function jobsFor(teamId: string) {
  const { data } = await adminClient.from("notification_jobs").select("*").eq("team_id", teamId);
  return (data ?? []) as Array<{ id: string; action: string; snapshot: Record<string, unknown> }>;
}

describe("team_reminder_settings RLS", () => {
  it("a coach can save the team's settings, recorded as theirs", async () => {
    const { coach, teamId } = await setup();

    expect((await writeSettings(coach, teamId)).error).toBeNull();

    expect(await settingsRow(teamId)).toMatchObject({ ...SETTINGS, updated_by: coach.user.id });
    expect((await writeSettings(coach, teamId, { enabled: true })).error).toBeNull();
    expect((await settingsRow(teamId))!.enabled).toBe(true);
  });

  it("a manager and the club's director can save them too, as they can edit events (D5)", async () => {
    const { teamId, orgId } = await setup();
    const manager = await memberOf(teamId, "manager");
    const director = await createTestUser();
    await addOrgMember(orgId, director.user.id, "director");

    expect((await writeSettings(manager, teamId)).error).toBeNull();
    expect((await writeSettings(director, teamId, { enabled: true })).error).toBeNull();
    expect((await settingsRow(teamId))!.updated_by).toBe(director.user.id);
  });

  it("parents and players can read them but not change them", async () => {
    const { coach, teamId } = await setup();
    await writeSettings(coach, teamId);
    for (const role of ["parent", "player"] as const) {
      const member = await memberOf(teamId, role);

      const { data } = await member.client.from("team_reminder_settings").select("*").eq("team_id", teamId);
      expect(data).toHaveLength(1);

      await writeSettings(member, teamId, { enabled: true });
      expect((await settingsRow(teamId))!.enabled).toBe(false);
    }
  });

  it("a parent can't create the row for a team that has none", async () => {
    const { teamId } = await setup();
    const parent = await memberOf(teamId, "parent");

    const { error } = await writeSettings(parent, teamId);

    expect(error).not.toBeNull();
    expect(await settingsRow(teamId)).toBeNull();
  });

  it("another team's coach can't read or write them", async () => {
    const { coach, teamId } = await setup();
    await writeSettings(coach, teamId);
    const { coach: other } = await setup();

    const { data } = await other.client.from("team_reminder_settings").select("*").eq("team_id", teamId);
    expect(data).toHaveLength(0);
    await writeSettings(other, teamId, { enabled: true });
    expect((await settingsRow(teamId))!.enabled).toBe(false);
  });

  it("saving them enqueues no notice (D13)", async () => {
    const { coach, teamId } = await setup();
    await createEvent(teamId, coach);

    await writeSettings(coach, teamId);
    await writeSettings(coach, teamId, { enabled: true, remind_practice: false });

    expect(await jobsFor(teamId)).toHaveLength(0);
  });
});

describe("events.reminder", () => {
  it("is set by whoever can edit the event, and no one else", async () => {
    const { coach, teamId } = await setup();
    const player = await memberOf(teamId, "player");
    const id = await createEvent(teamId, coach);

    expect((await coach.client.from("events").update({ reminder: "always" }).eq("id", id)).error).toBeNull();
    await player.client.from("events").update({ reminder: "never" }).eq("id", id);

    const { data } = await adminClient.from("events").select("reminder").eq("id", id).single();
    expect(data!.reminder).toBe("always");
  });

  it("is always, never, or the team default", async () => {
    const { coach, teamId } = await setup();
    const id = await createEvent(teamId, coach);

    const { error } = await coach.client.from("events").update({ reminder: "sometimes" }).eq("id", id);
    expect(error).not.toBeNull();
    expect((await coach.client.from("events").update({ reminder: null }).eq("id", id)).error).toBeNull();
  });

  it("changing only the reminder enqueues no notice (D13)", async () => {
    const { coach, teamId } = await setup();
    const id = await createEvent(teamId, coach, { arrival_time: 15 });

    await coach.client.from("events").update({ reminder: "never" }).eq("id", id);
    await coach.client.from("events").update({ reminder: "always" }).eq("id", id);
    await coach.client.from("events").update({ reminder: null }).eq("id", id);

    expect(await jobsFor(teamId)).toHaveLength(0);
  });
});

// ── Series edits (D13) ────────────────────────────────────────────────────────

/** A weekly series of 4 upcoming occurrences; the first is the head. */
async function createSeries(teamId: string, coach: TestUser) {
  const firstDay = new Date(Date.now() + 2 * DAY_MS);
  firstDay.setHours(16, 0, 0, 0);
  const starts = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(firstDay);
    d.setDate(d.getDate() + i * 7);
    return d;
  });
  const rule = buildRRule({
    frequency: "weekly",
    daysOfWeek: [(firstDay.getDay() + 6) % 7],
    dtstart: new Date(`${wall(starts[0])}:00.000Z`),
    until: untilEndOfDay(wall(starts[3]).slice(0, 10)),
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

function plan(rows: Awaited<ReturnType<typeof seriesRows>>, args: Partial<Parameters<typeof planSeriesEdit>[0]>) {
  return planSeriesEdit({
    occurrences: rows,
    openedId: rows[0].id,
    scope: "series",
    now: new Date(),
    fields: {},
    timeZone: "America/Los_Angeles",
    ...args,
  });
}

function apply(coach: TestUser, p: SeriesEditPlan) {
  return coach.client.rpc("apply_series_edit", { p_series_head_id: p.seriesHeadId, p_plan: p });
}

describe("series reminder edits (D13)", () => {
  it("a reminder-only edit sets every occurrence and enqueues nothing", async () => {
    const { coach, teamId } = await setup();
    const ids = await createSeries(teamId, coach);
    const p = plan(await seriesRows(ids), { fields: { reminder: "never" } });

    expect((await apply(coach, { ...p, summary: [] })).error).toBeNull();

    expect((await seriesRows(ids)).every((r) => r.reminder === "never")).toBe(true);
    expect(await jobsFor(teamId)).toHaveLength(0);
  });

  it("a reminder edit with another field enqueues one notice, listing only the other field", async () => {
    const { coach, teamId } = await setup();
    const ids = await createSeries(teamId, coach);
    const p = plan(await seriesRows(ids), { fields: { reminder: "always", notes: "Bring water" } });
    const summary = [{ field: "Notes", before: "—", after: "Bring water" }];

    expect((await apply(coach, { ...p, summary })).error).toBeNull();

    const rows = await seriesRows(ids);
    expect(rows.every((r) => r.reminder === "always" && r.notes === "Bring water")).toBe(true);
    const jobs = await jobsFor(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].snapshot.series_changes).toEqual(summary);
  });

  it("new occurrences carry the reminder, and adding them still notifies", async () => {
    const { coach, teamId } = await setup();
    const ids = await createSeries(teamId, coach);
    await adminClient.from("events").update({ reminder: "never" }).in("id", ids);
    const rows = await seriesRows(ids);
    const lastDay = new Date(rows[3].start_time);
    lastDay.setDate(lastDay.getDate() + 14);
    const weekday = (new Date(rows[0].start_time).getDay() + 6) % 7;
    const p = plan(rows, { pattern: { frequency: "weekly", daysOfWeek: [weekday], untilDate: wall(lastDay).slice(0, 10) } });
    expect(p.inserts).toHaveLength(2);

    expect((await apply(coach, { ...p, summary: [] })).error).toBeNull();

    const { data: added } = await adminClient.from("events").select("reminder").in("id", p.inserts.map((i) => i.id));
    expect(added!.map((r) => r.reminder)).toEqual(["never", "never"]);
    expect(await jobsFor(teamId)).toHaveLength(1);
  });
});

describe("the reminders job's log rows", () => {
  it("are never claimed by the notice worker, even left mid-flight", async () => {
    const { coach, teamId } = await setup();
    const eventId = await createEvent(teamId, coach);
    const jobId = crypto.randomUUID();
    const { error } = await adminClient.from("notification_jobs").insert({
      id: jobId,
      team_id: teamId,
      event_id: eventId,
      kind: "reminder",
      action: "reminder",
      snapshot: { title: "Practice" },
      status: "sending",
      batch_key: `reminder:${eventId}:test`,
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    expect(error).toBeNull();

    const { data } = await adminClient.rpc("claim_notification_jobs", { p_limit: 500 });

    expect((data ?? []).some((j: { id: string }) => j.id === jobId)).toBe(false);
  });
});
