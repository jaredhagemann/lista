/**
 * Reading responses for the events on screen (BUG-014, spec §7.1).
 *
 * The matrix used to ask for every response in a two-year window before showing
 * ten events: past the API cap the rows were silently dropped, and the whole
 * window's event ids went into one GET filter, which the gateway refused past a
 * few hundred with "URI too long".
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  fetchResponsesForEvents,
  fetchTeamRoster,
  AvailabilityQueryError,
  MAX_EVENT_IDS,
} from "@/lib/availability/queries";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  createManagedProfile,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

const HOUR_MS = 60 * 60 * 1000;

async function seedEvents(teamId: string, createdBy: string, count: number) {
  const base = Date.parse("2027-08-01T17:00:00.000Z");
  const rows = Array.from({ length: count }, (_, i) => ({
    id: crypto.randomUUID(),
    team_id: teamId,
    title: `Event ${i}`,
    event_type: "practice",
    start_time: new Date(base + i * HOUR_MS).toISOString(),
    end_time: new Date(base + i * HOUR_MS + HOUR_MS).toISOString(),
    created_by: createdBy,
  }));
  const { error } = await adminClient.from("events").insert(rows);
  if (error) throw new Error(error.message);
  return rows.map((r) => r.id);
}

async function seedResponses(eventIds: string[], profileIds: string[]) {
  const rows = eventIds.flatMap((event_id) =>
    profileIds.map((profile_id) => ({ event_id, profile_id, status: "available" }))
  );
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await adminClient.from("availability").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

describe("responses for a displayed page of events (BUG-014)", () => {
  it("returns every response when they cross a batch boundary", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    // Ten events on screen, 120 players: 1,200 responses, past the 1,000 cap and
    // across more than one keyed batch.
    const eventIds = await seedEvents(teamId, coach.user.id, 10);
    const playerIds: string[] = [];
    for (let i = 0; i < 120; i++) {
      playerIds.push(await createManagedProfile(coach.user.id, { firstName: `P${i}` }));
    }
    const expected = await seedResponses(eventIds, playerIds);
    expect(expected).toBe(1200);

    const responses = await fetchResponsesForEvents(coach.client, eventIds, { batchSize: 500 });

    expect(responses).toHaveLength(expected);
    expect(new Set(responses.map((r) => `${r.event_id}:${r.profile_id}`)).size).toBe(expected);
  });

  it("asks nothing when no events are displayed", async () => {
    const coach = await createTestUser();

    await expect(fetchResponsesForEvents(coach.client, [])).resolves.toEqual([]);
  });

  it("refuses a whole window's worth of ids rather than building a URL that fails", async () => {
    const coach = await createTestUser();
    const tooMany = Array.from({ length: MAX_EVENT_IDS + 1 }, () => crypto.randomUUID());

    await expect(fetchResponsesForEvents(coach.client, tooMany)).rejects.toBeInstanceOf(
      AvailabilityQueryError
    );
  });

  it("refuses a malformed event id", async () => {
    const coach = await createTestUser();

    await expect(
      fetchResponsesForEvents(coach.client, ["not-a-uuid"])
    ).rejects.toBeInstanceOf(AvailabilityQueryError);
  });

  it("refuses a batch the API cap cannot return", async () => {
    const coach = await createTestUser();

    await expect(
      fetchResponsesForEvents(coach.client, [crypto.randomUUID()], { batchSize: 2000 })
    ).rejects.toBeInstanceOf(AvailabilityQueryError);
  });

  it("shows a teammate's responses to a player, and nothing to an outsider", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");
    const eventIds = await seedEvents(teamId, coach.user.id, 2);
    await seedResponses(eventIds, [player.user.id]);

    const asPlayer = await fetchResponsesForEvents(player.client, eventIds);
    expect(asPlayer).toHaveLength(2);

    const outsider = await createTestUser();
    const asOutsider = await fetchResponsesForEvents(outsider.client, eventIds);
    expect(asOutsider).toHaveLength(0);
  });
});

describe("reading the roster (BUG-014, spec §7.2)", () => {
  it("returns every member, past one batch", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const managed: string[] = [];
    for (let i = 0; i < 12; i++) {
      managed.push(await createManagedProfile(coach.user.id, { firstName: `Kid${i}` }));
    }
    await Promise.all(managed.map((id) => addTeamMember(teamId, id, "player")));

    const roster = await fetchTeamRoster(coach.client, teamId, { batchSize: 5 });

    // The coach's own membership plus the twelve managed players.
    expect(roster).toHaveLength(13);
    expect(new Set(roster.map((m) => m.profileId)).size).toBe(13);
    expect(roster.every((m) => m.name.length > 0)).toBe(true);
  });

  it("refuses a malformed team id rather than returning an empty team", async () => {
    const coach = await createTestUser();

    await expect(fetchTeamRoster(coach.client, "not-a-team")).rejects.toBeInstanceOf(
      AvailabilityQueryError
    );
  });
});
