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
import { planSeriesEdit, seriesReminderTargets, type SeriesEditPlan } from "@/lib/events/series-edit";
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

/** Moves an occurrence by `hours`, on its own, as the single-event editor does. */
async function moveBy(id: string, hours: number) {
  const { data } = await adminClient.from("events").select("start_time, end_time").eq("id", id).single();
  const shift = (iso: string) => new Date(Date.parse(iso) + hours * 60 * 60 * 1000).toISOString();
  await adminClient.from("events").update({ start_time: shift(data!.start_time), end_time: shift(data!.end_time) }).eq("id", id);
  // The move's own notice, so it can't be mistaken for one from the edit under test.
  await adminClient.from("notification_jobs").delete().eq("event_id", id);
}

/** What a reminder-only series edit must leave as it was. */
const shape = (rows: Awaited<ReturnType<typeof seriesRows>>) =>
  rows.map((r) => ({
    id: r.id,
    start_time: r.start_time,
    end_time: r.end_time,
    parent_event_id: r.parent_event_id,
    recurrence_rule: r.recurrence_rule,
    is_cancelled: r.is_cancelled,
  }));

/** The series editor's reminder-only save (review RR-002). */
function setSeriesReminder(coach: TestUser, targets: string[], reminder: "always" | "never" | null) {
  return coach.client.from("events").update({ reminder }).in("id", targets);
}

describe("reminder-only series edits around rescheduled occurrences (review RR-002)", () => {
  it("Entire series: reaches the moved ones, adds and moves nothing, and tells nobody", async () => {
    const { coach, teamId } = await setup();
    const ids = await createSeries(teamId, coach);
    await moveBy(ids[1], 24); // to the next day
    await moveBy(ids[2], 2); // later the same day
    await adminClient.from("events").update({ reminder: "always" }).eq("id", ids[3]);
    const before = await seriesRows(ids);

    const targets = seriesReminderTargets({ occurrences: before, openedId: ids[0], scope: "series", now: new Date() });
    expect((await setSeriesReminder(coach, targets, "never")).error).toBeNull();

    const after = await seriesRows(ids);
    expect(shape(after)).toEqual(shape(before));
    expect(after.map((r) => r.reminder)).toEqual(["never", "never", "never", "never"]);
    const { count } = await adminClient.from("events").select("id", { count: "exact", head: true }).eq("team_id", teamId);
    expect(count).toBe(4);
    expect(await jobsFor(teamId)).toHaveLength(0);
  });

  it("This and following: only from the opened occurrence, and the series isn't split", async () => {
    const { coach, teamId } = await setup();
    const ids = await createSeries(teamId, coach);
    await moveBy(ids[2], 24);
    const before = await seriesRows(ids);

    const targets = seriesReminderTargets({ occurrences: before, openedId: ids[2], scope: "following", now: new Date() });
    expect((await setSeriesReminder(coach, targets, "always")).error).toBeNull();

    const after = await seriesRows(ids);
    expect(shape(after)).toEqual(shape(before));
    expect(after.map((r) => r.reminder)).toEqual([null, null, "always", "always"]);
    expect(await jobsFor(teamId)).toHaveLength(0);
  });

  it("a reminder change alongside another field reaches an occurrence moved within its day", async () => {
    const { coach, teamId } = await setup();
    const ids = await createSeries(teamId, coach);
    await moveBy(ids[2], 2);
    const p = plan(await seriesRows(ids), { fields: { reminder: "never", notes: "Bring water" } });

    expect((await apply(coach, { ...p, summary: [{ field: "Notes", before: "—", after: "Bring water" }] })).error).toBeNull();

    const after = await seriesRows(ids);
    expect(after.map((r) => r.reminder)).toEqual(["never", "never", "never", "never"]);
    // The moved one keeps its own time and notes; only its reminder follows the series.
    expect(after[2].notes).toBeNull();
    expect(p.inserts).toHaveLength(0);
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

// ── Claiming a reminder (review RR-001) ───────────────────────────────────────

type Claim = { id: string; sent: Array<{ profile_id: string; channel: string; target: string | null }> } | null;

function claim(teamId: string, eventId: string, key: string, retryOnly = false) {
  return adminClient.rpc("claim_reminder_job", {
    p_team_id: teamId,
    p_event_id: eventId,
    p_snapshot: { title: "Practice" },
    p_batch_key: key,
    p_retry_only: retryOnly,
  }) as unknown as Promise<{ data: Claim; error: { message: string } | null }>;
}

async function job(id: string) {
  const { data } = await adminClient.from("notification_jobs").select("*").eq("id", id).single();
  return data!;
}

async function reminderFixture() {
  const { coach, teamId } = await setup();
  const eventId = await createEvent(teamId, coach);
  return { coach, teamId, eventId, key: `reminder:${eventId}:${crypto.randomUUID()}` };
}

describe("claim_reminder_job (review RR-001)", () => {
  it("the first claim logs the reminder as being sent, with nothing sent yet", async () => {
    const { teamId, eventId, key } = await reminderFixture();

    const { data, error } = await claim(teamId, eventId, key);

    expect(error).toBeNull();
    expect(data!.sent).toEqual([]);
    expect(await job(data!.id)).toMatchObject({ kind: "reminder", status: "sending", attempts: 1, batch_key: key });
  });

  it("a run that overlaps one still sending gets nothing", async () => {
    const { teamId, eventId, key } = await reminderFixture();
    await claim(teamId, eventId, key);

    expect((await claim(teamId, eventId, key)).data).toBeNull();
  });

  it("a reminder that went out is never claimed again", async () => {
    const { teamId, eventId, key } = await reminderFixture();
    const first = (await claim(teamId, eventId, key)).data!;
    await adminClient.from("notification_jobs").update({ status: "sent" }).eq("id", first.id);

    expect((await claim(teamId, eventId, key)).data).toBeNull();
  });

  it("a failed or partly sent one is claimed again: what went out stays, the rest is cleared to retry", async () => {
    const { coach, teamId, eventId, key } = await reminderFixture();
    const first = (await claim(teamId, eventId, key)).data!;
    await adminClient.from("notification_deliveries").insert([
      { job_id: first.id, profile_id: coach.user.id, channel: "email", target: "coach@example.com", status: "sent" },
      { job_id: first.id, profile_id: coach.user.id, channel: "push", target: "ExponentPushToken[x]", status: "failed", reason: "boom" },
    ]);
    await adminClient.from("notification_jobs").update({ status: "partial", last_error: "1 deliveries failed" }).eq("id", first.id);

    const again = (await claim(teamId, eventId, key)).data!;

    expect(again.id).toBe(first.id);
    expect(again.sent).toEqual([{ profile_id: coach.user.id, channel: "email", target: "coach@example.com" }]);
    expect(await job(first.id)).toMatchObject({ status: "sending", attempts: 2, last_error: null });
    const { data: rows } = await adminClient.from("notification_deliveries").select("status").eq("job_id", first.id);
    expect(rows!.map((r) => r.status)).toEqual(["sent"]);
  });

  it("one left sending for more than ten minutes, by a run that died, is claimed again", async () => {
    const { teamId, eventId, key } = await reminderFixture();
    const first = (await claim(teamId, eventId, key)).data!;
    await adminClient
      .from("notification_jobs")
      .update({ claimed_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() })
      .eq("id", first.id);

    expect((await claim(teamId, eventId, key)).data!.id).toBe(first.id);
  });

  it("gives up after five attempts", async () => {
    const { teamId, eventId, key } = await reminderFixture();
    const first = (await claim(teamId, eventId, key)).data!;
    await adminClient.from("notification_jobs").update({ status: "failed", attempts: 5 }).eq("id", first.id);

    expect((await claim(teamId, eventId, key)).data).toBeNull();
  });

  it("a retry-only claim never starts a reminder that wasn't sent", async () => {
    const { teamId, eventId, key } = await reminderFixture();

    expect((await claim(teamId, eventId, key, true)).data).toBeNull();
    expect(await jobsFor(teamId)).toHaveLength(0);
  });

  it("can't be called by a signed-in user", async () => {
    const { coach, teamId, eventId, key } = await reminderFixture();

    const { error } = await coach.client.rpc("claim_reminder_job", {
      p_team_id: teamId,
      p_event_id: eventId,
      p_snapshot: {},
      p_batch_key: key,
      p_retry_only: false,
    });

    expect(error).not.toBeNull();
    expect(await jobsFor(teamId)).toHaveLength(0);
  });
});
