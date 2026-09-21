/**
 * Reading a list completely, past the API's row cap (BUG-014).
 *
 * PostgREST returns at most `max_rows` (1,000, in this project's config and in
 * production). The schedule, availability matrix and club member list each
 * asked for every matching row in one query, so past the cap rows were dropped
 * with no error — and a missing availability row renders as "no response",
 * which is indistinguishable from a genuine non-reply.
 *
 * fetchAllRows pages until it sees a short page, so completeness does not depend
 * on staying under a limit nobody can see from the call site.
 */

import { describe, it, expect, afterAll } from "vitest";
import { fetchAllRows, PartialFetchError } from "@/lib/supabase/fetch-all-rows";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  createManagedProfile,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

const API_MAX_ROWS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A season's worth of responses: enough rows that one unpaginated query cannot
 * return them all. 21 players across 50 events is 1,050 — just past the cap,
 * which is the shape the ticket describes.
 */
async function seedPastTheCap(teamId: string, coachId: string) {
  const playerIds: string[] = [];
  for (let i = 0; i < 21; i++) {
    playerIds.push(await createManagedProfile(coachId, { firstName: `Player${i}` }));
  }
  await Promise.all(playerIds.map((id) => addTeamMember(teamId, id, "player")));

  const events = Array.from({ length: 50 }, (_, i) => ({
    id: crypto.randomUUID(),
    team_id: teamId,
    title: `Practice ${i}`,
    event_type: "practice",
    start_time: new Date(Date.now() + i * DAY_MS).toISOString(),
    end_time: new Date(Date.now() + i * DAY_MS + 3600_000).toISOString(),
    created_by: coachId,
  }));
  const { error: eventError } = await adminClient.from("events").insert(events);
  if (eventError) throw new Error(eventError.message);

  const responses = events.flatMap((event) =>
    playerIds.map((profileId) => ({
      event_id: event.id,
      profile_id: profileId,
      status: "available",
    }))
  );
  // Insert in chunks: the write has its own limits.
  for (let i = 0; i < responses.length; i += 500) {
    const { error } = await adminClient.from("availability").insert(responses.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  return { eventIds: events.map((e) => e.id), expected: responses.length };
}

describe("fetchAllRows (BUG-014)", () => {
  it("returns every row where a single query would stop at the cap", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const { eventIds, expected } = await seedPastTheCap(teamId, coach.user.id);
    expect(expected).toBeGreaterThan(API_MAX_ROWS);

    // What the pages used to do.
    const { data: unpaginated } = await adminClient
      .from("availability")
      .select("event_id, profile_id, status")
      .in("event_id", eventIds);
    expect(unpaginated).toHaveLength(API_MAX_ROWS);

    const all = await fetchAllRows((from, to) =>
      adminClient
        .from("availability")
        .select("event_id, profile_id, status")
        .in("event_id", eventIds)
        .order("event_id")
        .range(from, to)
    );

    expect(all).toHaveLength(expected);
    expect(new Set(all.map((r) => `${r.event_id}:${r.profile_id}`)).size).toBe(expected);
  });

  it("returns an empty list without asking twice", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    let calls = 0;

    const all = await fetchAllRows((from, to) => {
      calls++;
      return adminClient
        .from("availability")
        .select("event_id")
        .eq("event_id", teamId) // no such event: nothing matches
        .range(from, to);
    });

    expect(all).toEqual([]);
    expect(calls).toBe(1);
  });

  it("raises a partial-fetch error rather than returning half a list", async () => {
    const coach = await createTestUser();
    const { teamId } = await createTestTeam(coach.user.id);
    const { eventIds } = await seedPastTheCap(teamId, coach.user.id);

    // The second page fails, as a dropped connection would.
    let page = 0;
    const attempt = fetchAllRows(async (from, to) => {
      page++;
      if (page > 1) return { data: null, error: { message: "connection reset" } };
      return adminClient
        .from("availability")
        .select("event_id, profile_id, status")
        .in("event_id", eventIds)
        .order("event_id")
        .range(from, to);
    });

    await expect(attempt).rejects.toBeInstanceOf(PartialFetchError);
    await expect(attempt).rejects.toThrow(/connection reset/);
  });

  it("stops at a safety limit instead of paging forever", async () => {
    // A query that always returns a full page would otherwise never end.
    const fullPage = Array.from({ length: 500 }, (_, i) => ({ id: String(i) }));

    await expect(
      fetchAllRows(async () => ({ data: fullPage, error: null }), { pageSize: 500, maxRows: 1500 })
    ).rejects.toBeInstanceOf(PartialFetchError);
  });
});
