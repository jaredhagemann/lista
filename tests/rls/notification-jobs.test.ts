/**
 * Which schedule changes enqueue a notification (BUG-006, decision D3).
 *
 * Every event mutation used to finish at the database write, so families were
 * never told. Enqueueing now happens in the database itself, in the same
 * transaction as the change:
 *
 *   - the cases a coach cannot suppress (time, arrival time or location change;
 *     cancel, restore, delete) come from a trigger, so no UI path can skip them
 *   - the suppressible ones (creating an event, a title-only edit) are enqueued
 *     explicitly by the app through enqueue_event_notification()
 *   - historical events and no-op saves enqueue nothing
 *   - one operation produces one job per team, however many occurrences it
 *     touched, and a deleted event's job still describes it
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const HOUR_MS = 60 * 60 * 1000;

async function createEvent(
  teamId: string,
  coach: TestUser,
  overrides: Record<string, unknown> = {}
) {
  const id = crypto.randomUUID();
  const start = new Date(Date.now() + 48 * HOUR_MS);
  const { error } = await adminClient.from("events").insert({
    id,
    team_id: teamId,
    title: "Practice",
    event_type: "practice",
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 90 * 60 * 1000).toISOString(),
    arrival_time: 15,
    created_by: coach.user.id,
    ...overrides,
  });
  if (error) throw new Error(error.message);
  return id;
}

async function jobsFor(teamId: string) {
  const { data } = await adminClient
    .from("notification_jobs")
    .select("*")
    .eq("team_id", teamId)
    .order("created_at");
  return data ?? [];
}

async function setup() {
  const coach = await createTestUser();
  const player = await createTestUser();
  const { teamId } = await createTestTeam(coach.user.id);
  await addTeamMember(teamId, player.user.id, "player");
  return { coach, player, teamId };
}

// ── The cases a coach cannot suppress ─────────────────────────────────────────

describe("mandatory notifications (BUG-006, D3)", () => {
  it("cancelling an upcoming event enqueues one job that describes it", async () => {
    const { coach, teamId } = await setup();
    const eventId = await createEvent(teamId, coach);

    const { error } = await coach.client
      .from("events")
      .update({ is_cancelled: true })
      .eq("id", eventId);
    expect(error).toBeNull();

    const jobs = await jobsFor(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].action).toBe("cancelled");
    expect(jobs[0].status).toBe("pending");
    expect(jobs[0].event_id).toBe(eventId);
    const snapshot = jobs[0].snapshot as { title: string; start_time: string };
    expect(snapshot.title).toBe("Practice");
    expect(snapshot.start_time).not.toBeUndefined();
  });

  it("restoring a cancelled event enqueues a restored job", async () => {
    const { coach, teamId } = await setup();
    const eventId = await createEvent(teamId, coach, { is_cancelled: true });

    await coach.client.from("events").update({ is_cancelled: false }).eq("id", eventId);

    const jobs = await jobsFor(teamId);
    expect(jobs.map((j) => j.action)).toEqual(["restored"]);
  });

  it("changing the time or the location enqueues an updated job", async () => {
    const { coach, teamId } = await setup();
    const timeEventId = await createEvent(teamId, coach);
    const locationEventId = await createEvent(teamId, coach);
    const { data: location } = await adminClient
      .from("locations")
      .insert({ id: crypto.randomUUID(), team_id: teamId, name: "New Field" })
      .select("id")
      .single();

    await coach.client
      .from("events")
      .update({ start_time: new Date(Date.now() + 72 * HOUR_MS).toISOString() })
      .eq("id", timeEventId);
    await coach.client
      .from("events")
      .update({ location_id: location!.id })
      .eq("id", locationEventId);

    const jobs = await jobsFor(teamId);
    expect(jobs.map((j) => j.action)).toEqual(["updated", "updated"]);
    expect(jobs.map((j) => j.event_id).sort()).toEqual([timeEventId, locationEventId].sort());
  });

  it("deleting an upcoming event enqueues a job that still describes the deleted event", async () => {
    const { coach, teamId } = await setup();
    const eventId = await createEvent(teamId, coach, { title: "Team photo" });

    await coach.client.rpc("delete_event_occurrence", { p_event_id: eventId });

    const jobs = await jobsFor(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].action).toBe("deleted");
    expect((jobs[0].snapshot as { title: string }).title).toBe("Team photo");
    const { data: gone } = await adminClient.from("events").select("id").eq("id", eventId);
    expect(gone).toHaveLength(0);
  });
});

// ── The cases that must stay quiet ────────────────────────────────────────────

describe("changes that notify nobody (BUG-006, D3)", () => {
  it("a title-only edit enqueues nothing", async () => {
    const { coach, teamId } = await setup();
    const eventId = await createEvent(teamId, coach);

    await coach.client
      .from("events")
      .update({ title: "Practice (turf)", notes: "Bring both kits" })
      .eq("id", eventId);

    expect(await jobsFor(teamId)).toHaveLength(0);
  });

  it("saving with no actual change enqueues nothing", async () => {
    const { coach, teamId } = await setup();
    const eventId = await createEvent(teamId, coach);
    const { data: before } = await adminClient
      .from("events")
      .select("title, start_time, end_time, arrival_time, location_id")
      .eq("id", eventId)
      .single();

    await coach.client.from("events").update(before!).eq("id", eventId);

    expect(await jobsFor(teamId)).toHaveLength(0);
  });

  it("editing a historical event enqueues nothing", async () => {
    const { coach, teamId } = await setup();
    const past = new Date(Date.now() - 72 * HOUR_MS);
    const eventId = await createEvent(teamId, coach, {
      start_time: past.toISOString(),
      end_time: new Date(past.getTime() + HOUR_MS).toISOString(),
    });

    await coach.client
      .from("events")
      .update({ start_time: new Date(past.getTime() + HOUR_MS).toISOString() })
      .eq("id", eventId);
    await coach.client.from("events").update({ is_cancelled: true }).eq("id", eventId);

    expect(await jobsFor(teamId)).toHaveLength(0);
  });

  it("deleting an already-cancelled event sends no second notice", async () => {
    const { coach, teamId } = await setup();
    const eventId = await createEvent(teamId, coach, { is_cancelled: true });

    await coach.client.rpc("delete_event_occurrence", { p_event_id: eventId });

    expect(await jobsFor(teamId)).toHaveLength(0);
  });

  it("deleting a whole team enqueues nothing", async () => {
    const { coach, teamId } = await setup();
    await createEvent(teamId, coach);
    await createEvent(teamId, coach);

    const { error } = await adminClient.from("teams").delete().eq("id", teamId);
    expect(error).toBeNull();

    const { data: orphaned } = await adminClient
      .from("notification_jobs")
      .select("id")
      .eq("team_id", teamId);
    expect(orphaned ?? []).toHaveLength(0);
  });

  it("changes to an already-cancelled event enqueue nothing", async () => {
    const { coach, teamId } = await setup();
    const eventId = await createEvent(teamId, coach, { is_cancelled: true });

    await coach.client
      .from("events")
      .update({ start_time: new Date(Date.now() + 96 * HOUR_MS).toISOString() })
      .eq("id", eventId);

    expect(await jobsFor(teamId)).toHaveLength(0);
  });
});

// ── One operation, one notice ─────────────────────────────────────────────────

describe("batching (BUG-006, D3)", () => {
  it("one bulk update across many occurrences enqueues a single job for the team", async () => {
    const { coach, teamId } = await setup();
    const ids = [] as string[];
    for (let i = 0; i < 4; i++) {
      ids.push(await createEvent(teamId, coach, { title: "Weekly practice" }));
    }

    // One statement, one transaction — the shape apply_series_edit produces.
    const { error } = await coach.client
      .from("events")
      .update({ arrival_time: 30 })
      .in("id", ids);
    expect(error).toBeNull();

    const jobs = await jobsFor(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].action).toBe("updated");
    expect(jobs[0].occurrence_count).toBe(4);
  });

  it("separate operations stay separate", async () => {
    const { coach, teamId } = await setup();
    const first = await createEvent(teamId, coach);
    const second = await createEvent(teamId, coach);

    await coach.client.from("events").update({ arrival_time: 30 }).eq("id", first);
    await coach.client.from("events").update({ arrival_time: 30 }).eq("id", second);

    expect(await jobsFor(teamId)).toHaveLength(2);
  });
});

// ── The suppressible cases, enqueued by the app ───────────────────────────────

describe("enqueue_event_notification (BUG-006, D3)", () => {
  it("an admin enqueues a creation notice, and skipping the call sends nothing", async () => {
    const { coach, teamId } = await setup();
    const announced = await createEvent(teamId, coach);
    await createEvent(teamId, coach); // created with the toggle off — no call

    const { error } = await coach.client.rpc("enqueue_event_notification", {
      p_event_id: announced,
      p_action: "created",
    });
    expect(error).toBeNull();

    const jobs = await jobsFor(teamId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].action).toBe("created");
    expect(jobs[0].event_id).toBe(announced);
  });

  it("refuses a non-admin, and refuses a historical event", async () => {
    const { coach, player, teamId } = await setup();
    const upcoming = await createEvent(teamId, coach);
    const past = new Date(Date.now() - 72 * HOUR_MS);
    const historical = await createEvent(teamId, coach, {
      start_time: past.toISOString(),
      end_time: new Date(past.getTime() + HOUR_MS).toISOString(),
    });

    const { error: playerError } = await player.client.rpc("enqueue_event_notification", {
      p_event_id: upcoming,
      p_action: "created",
    });
    expect(playerError).not.toBeNull();

    const { error: historicalError } = await coach.client.rpc("enqueue_event_notification", {
      p_event_id: historical,
      p_action: "created",
    });
    expect(historicalError).not.toBeNull();

    expect(await jobsFor(teamId)).toHaveLength(0);
  });
});

// ── Who can read delivery status ──────────────────────────────────────────────

describe("notification job visibility (BUG-006, D3)", () => {
  it("team admins see their team's jobs; other members and outsiders do not", async () => {
    const { coach, player, teamId } = await setup();
    const eventId = await createEvent(teamId, coach);
    await coach.client.from("events").update({ is_cancelled: true }).eq("id", eventId);
    const outsider = await createTestUser();

    const { data: adminView } = await coach.client
      .from("notification_jobs")
      .select("id, status")
      .eq("team_id", teamId);
    expect(adminView).toHaveLength(1);

    const { data: playerView } = await player.client
      .from("notification_jobs")
      .select("id")
      .eq("team_id", teamId);
    expect(playerView ?? []).toHaveLength(0);

    const { data: outsiderView } = await outsider.client
      .from("notification_jobs")
      .select("id")
      .eq("team_id", teamId);
    expect(outsiderView ?? []).toHaveLength(0);
  });

  it("nobody can write a job or a delivery row from the client", async () => {
    const { coach, teamId } = await setup();

    const { error: rpcError } = await coach.client.rpc("enqueue_notification_job", {
      p_team_id: teamId,
      p_event_id: null,
      p_action: "cancelled",
      p_snapshot: { title: "Fake" },
    });
    expect(rpcError).not.toBeNull();

    const { error: insertError } = await coach.client.from("notification_jobs").insert({
      team_id: teamId,
      action: "cancelled",
      snapshot: { title: "Fake" },
    });
    expect(insertError).not.toBeNull();

    const eventId = await createEvent(teamId, coach);
    await coach.client.from("events").update({ is_cancelled: true }).eq("id", eventId);
    const [job] = await jobsFor(teamId);

    // An UPDATE with no policy behind it matches no rows rather than erroring,
    // so the row itself is the assertion.
    await coach.client.from("notification_jobs").update({ status: "sent" }).eq("id", job.id);

    const { data: unchanged } = await adminClient
      .from("notification_jobs")
      .select("status")
      .eq("id", job.id)
      .single();
    expect(unchanged!.status).toBe("pending");
  });
});

// ── What the worker claims ────────────────────────────────────────────────────

describe("claiming jobs for a worker run (BUG-006)", () => {
  async function pendingJob(teamId: string, coach: TestUser) {
    const eventId = await createEvent(teamId, coach);
    await coach.client.from("events").update({ is_cancelled: true }).eq("id", eventId);
    const [job] = await jobsFor(teamId);
    return job;
  }

  it("claims a pending job once, counting the attempt", async () => {
    const { coach, teamId } = await setup();
    const job = await pendingJob(teamId, coach);

    const { data: first } = await adminClient.rpc("claim_notification_jobs", { p_limit: 100 });
    const claimed = (first ?? []).filter((j: { id: string }) => j.id === job.id);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].status).toBe("sending");
    expect(claimed[0].attempts).toBe(1);

    // A second worker running at the same moment finds nothing to do.
    const { data: second } = await adminClient.rpc("claim_notification_jobs", { p_limit: 100 });
    expect((second ?? []).filter((j: { id: string }) => j.id === job.id)).toHaveLength(0);
  });

  it("reclaims a job a crashed run left mid-flight, but gives up after five attempts", async () => {
    const { coach, teamId } = await setup();
    const stuck = await pendingJob(teamId, coach);
    await adminClient
      .from("notification_jobs")
      .update({
        status: "sending",
        created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      })
      .eq("id", stuck.id);

    const { data: reclaimed } = await adminClient.rpc("claim_notification_jobs", { p_limit: 100 });
    expect((reclaimed ?? []).filter((j: { id: string }) => j.id === stuck.id)).toHaveLength(1);

    await adminClient
      .from("notification_jobs")
      .update({ status: "pending", attempts: 5 })
      .eq("id", stuck.id);
    const { data: exhausted } = await adminClient.rpc("claim_notification_jobs", { p_limit: 100 });
    expect((exhausted ?? []).filter((j: { id: string }) => j.id === stuck.id)).toHaveLength(0);
  });

  it("is not callable by a signed-in user", async () => {
    const { coach, teamId } = await setup();
    await pendingJob(teamId, coach);

    const { error } = await coach.client.rpc("claim_notification_jobs", { p_limit: 100 });
    expect(error).not.toBeNull();
  });
});
