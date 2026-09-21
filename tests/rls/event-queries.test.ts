/**
 * Cursor-based event reads (BUG-014, spec §4).
 *
 * The previous attempt paged with OFFSET and ordered by `start_time` alone.
 * Simultaneous events tie under that ordering, so a page boundary could repeat
 * one event and skip another — and deleting an already-returned row shifted
 * every later offset past a row that still existed. Both produced a successful,
 * silently incomplete read, which for availability renders as "no response".
 *
 * Keysets on `(start_time, id)` make each page continue from a unique position,
 * so traversal is deterministic for unchanged keys and survives deletions behind
 * the cursor.
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  fetchEventPage,
  fetchEventRange,
  EventQueryError,
  IncompleteRangeError,
  MAX_PAGE_SIZE,
  type EventCursor,
} from "@/lib/events/queries";
import {
  adminClient,
  createTestUser,
  createTestTeam,
  addTeamMember,
  createManagedProfile,
  cleanupTestData,
} from "./helpers";

afterAll(cleanupTestData);

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const HOUR_MS = 60 * 60 * 1000;
const BASE = Date.parse("2026-10-01T17:00:00.000Z");

async function seedEvents(
  teamId: string,
  createdBy: string,
  specs: { startTime: string; title?: string; type?: string; cancelled?: boolean }[]
) {
  const rows = specs.map((spec, i) => ({
    id: crypto.randomUUID(),
    team_id: teamId,
    title: spec.title ?? `Event ${i}`,
    event_type: spec.type ?? "practice",
    start_time: spec.startTime,
    end_time: new Date(Date.parse(spec.startTime.replace(/(\.\d{3})\d+/, "$1")) + HOUR_MS).toISOString(),
    is_cancelled: spec.cancelled ?? false,
    created_by: createdBy,
  }));
  const { error } = await adminClient.from("events").insert(rows);
  if (error) throw new Error(error.message);
  return rows.map((r) => r.id);
}

function evenlySpaced(count: number, from = BASE) {
  return Array.from({ length: count }, (_, i) => ({
    startTime: new Date(from + i * HOUR_MS).toISOString(),
  }));
}

/** Walks every page, returning the ids in the order they were handed out. */
async function traverse(
  client: TestUser["client"],
  teamId: string,
  pageSize: number
): Promise<string[]> {
  const seen: string[] = [];
  let cursor: EventCursor | null = null;

  for (let guard = 0; guard < 200; guard++) {
    const page = await fetchEventPage(client, {
      query: { teamId, includeCancelled: true },
      pageSize,
      cursor,
      projection: "calendar",
    });
    seen.push(...page.items.map((e) => e.id));
    if (!page.hasNext) return seen;
    cursor = page.nextCursor;
    expect(cursor).not.toBeNull();
  }
  throw new Error("traversal did not terminate");
}

async function setup() {
  const coach = await createTestUser();
  const { teamId } = await createTestTeam(coach.user.id);
  return { coach, teamId };
}

// ── Completeness ──────────────────────────────────────────────────────────────

describe("traversing a team's events (BUG-014)", () => {
  it.each([0, 1, 5, 6, 11])("returns every event exactly once for %i events", async (count) => {
    const { coach, teamId } = await setup();
    const ids = count > 0 ? await seedEvents(teamId, coach.user.id, evenlySpaced(count)) : [];

    const seen = await traverse(coach.client, teamId, 5);

    expect(seen).toHaveLength(count);
    expect(new Set(seen).size).toBe(count);
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it("separates events that share a start time, to the microsecond", async () => {
    const { coach, teamId } = await setup();
    // Three at the same instant, and two a fraction of a millisecond apart —
    // a JavaScript Date cannot tell the last two apart, so a cursor built by
    // parsing one would stall or skip.
    const sameInstant = "2026-10-02T17:00:00.000000Z";
    const ids = await seedEvents(teamId, coach.user.id, [
      { startTime: sameInstant },
      { startTime: sameInstant },
      { startTime: sameInstant },
      { startTime: "2026-10-02T18:00:00.000100Z" },
      { startTime: "2026-10-02T18:00:00.000200Z" },
    ]);

    const seen = await traverse(coach.client, teamId, 2);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it("reads a thousand events completely, in order", async () => {
    const { coach, teamId } = await setup();
    await seedEvents(teamId, coach.user.id, evenlySpaced(1001));

    const seen = await traverse(coach.client, teamId, 250);

    expect(seen).toHaveLength(1001);
    expect(new Set(seen).size).toBe(1001);
  });

  it("keeps going when the row the cursor names is deleted behind it", async () => {
    const { coach, teamId } = await setup();
    await seedEvents(teamId, coach.user.id, evenlySpaced(6));

    const first = await fetchEventPage(coach.client, {
      query: { teamId, includeCancelled: true },
      pageSize: 3,
      cursor: null,
      projection: "calendar",
    });
    expect(first.hasNext).toBe(true);

    // The cursor row itself goes away between requests — the case that made
    // offset paging skip a row that still existed.
    await adminClient.from("events").delete().eq("id", first.items[2].id);

    const second = await fetchEventPage(coach.client, {
      query: { teamId, includeCancelled: true },
      pageSize: 3,
      cursor: first.nextCursor,
      projection: "calendar",
    });

    const seen = [...first.items, ...second.items].map((e) => e.id);
    expect(new Set(seen).size).toBe(6);
    expect(second.hasNext).toBe(false);
  });
});

// ── Filters apply before the page limit ───────────────────────────────────────

describe("filters (BUG-014)", () => {
  it("applies date, type and cancellation before the limit, not after", async () => {
    const { coach, teamId } = await setup();
    await seedEvents(teamId, coach.user.id, [
      { startTime: "2026-10-05T17:00:00.000Z", type: "practice" },
      { startTime: "2026-10-06T17:00:00.000Z", type: "game" },
      { startTime: "2026-10-07T17:00:00.000Z", type: "practice", cancelled: true },
      { startTime: "2026-11-05T17:00:00.000Z", type: "practice" },
    ]);

    const games = await fetchEventPage(coach.client, {
      query: { teamId, eventType: "game", includeCancelled: true },
      pageSize: 10,
      cursor: null,
      projection: "calendar",
    });
    expect(games.items.map((e) => e.event_type)).toEqual(["game"]);

    const october = await fetchEventPage(coach.client, {
      query: {
        teamId,
        fromInclusive: "2026-10-01T00:00:00.000Z",
        toExclusive: "2026-11-01T00:00:00.000Z",
        includeCancelled: true,
      },
      pageSize: 10,
      cursor: null,
      projection: "calendar",
    });
    expect(october.items).toHaveLength(3);

    const live = await fetchEventPage(coach.client, {
      query: { teamId, includeCancelled: false },
      pageSize: 10,
      cursor: null,
      projection: "calendar",
    });
    expect(live.items).toHaveLength(3);
  });

  it("treats a null is_cancelled as not cancelled", async () => {
    const { coach, teamId } = await setup();
    const [id] = await seedEvents(teamId, coach.user.id, evenlySpaced(1));
    // Rows predating the column's default carry null, and `.eq(false)` would
    // drop them — changing which events the calendar shows.
    await adminClient.from("events").update({ is_cancelled: null }).eq("id", id);

    const live = await fetchEventPage(coach.client, {
      query: { teamId, includeCancelled: false },
      pageSize: 10,
      cursor: null,
      projection: "calendar",
    });

    expect(live.items.map((e) => e.id)).toEqual([id]);
  });

  it("uses half-open date bounds, so a boundary event belongs to one range only", async () => {
    const { coach, teamId } = await setup();
    const boundary = "2026-11-01T00:00:00.000Z";
    const [id] = await seedEvents(teamId, coach.user.id, [{ startTime: boundary }]);

    const october = await fetchEventPage(coach.client, {
      query: { teamId, fromInclusive: "2026-10-01T00:00:00.000Z", toExclusive: boundary, includeCancelled: true },
      pageSize: 10,
      cursor: null,
      projection: "calendar",
    });
    const november = await fetchEventPage(coach.client, {
      query: { teamId, fromInclusive: boundary, toExclusive: "2026-12-01T00:00:00.000Z", includeCancelled: true },
      pageSize: 10,
      cursor: null,
      projection: "calendar",
    });

    expect(october.items).toHaveLength(0);
    expect(november.items.map((e) => e.id)).toEqual([id]);
  });
});

// ── Validation and authorization ──────────────────────────────────────────────

describe("what the repository refuses (BUG-014)", () => {
  it("rejects a page size the API cap cannot honour", async () => {
    const { coach, teamId } = await setup();

    await expect(
      fetchEventPage(coach.client, {
        query: { teamId, includeCancelled: true },
        pageSize: 5000,
        cursor: null,
        projection: "calendar",
      })
    ).rejects.toBeInstanceOf(EventQueryError);
  });

  it("rejects a malformed cursor or team id rather than guessing", async () => {
    const { coach, teamId } = await setup();

    await expect(
      fetchEventPage(coach.client, {
        query: { teamId, includeCancelled: true },
        pageSize: 10,
        cursor: { startTime: "not-a-time", id: "not-a-uuid" },
        projection: "calendar",
      })
    ).rejects.toBeInstanceOf(EventQueryError);

    await expect(
      fetchEventPage(coach.client, {
        query: { teamId: "'; drop table events; --", includeCancelled: true },
        pageSize: 10,
        cursor: null,
        projection: "calendar",
      })
    ).rejects.toBeInstanceOf(EventQueryError);
  });

  it("cannot be pointed at another team's events with a borrowed cursor", async () => {
    const { coach, teamId } = await setup();
    await seedEvents(teamId, coach.user.id, evenlySpaced(3));

    const otherCoach = await createTestUser();
    const { teamId: otherTeamId } = await createTestTeam(otherCoach.user.id);
    const otherIds = await seedEvents(otherTeamId, otherCoach.user.id, evenlySpaced(3, BASE - 5 * HOUR_MS));

    // A cursor is a position, not a key: it cannot widen what the caller reads.
    const page = await fetchEventPage(coach.client, {
      query: { teamId, includeCancelled: true },
      pageSize: 10,
      cursor: { startTime: new Date(BASE - 6 * HOUR_MS).toISOString(), id: otherIds[0] },
      projection: "calendar",
    });

    expect(page.items.every((e) => e.team_id === teamId)).toBe(true);
  });

  it("refuses a team the caller is not on, via RLS", async () => {
    const { coach, teamId } = await setup();
    await seedEvents(teamId, coach.user.id, evenlySpaced(3));
    const outsider = await createTestUser();

    const page = await fetchEventPage(outsider.client, {
      query: { teamId, includeCancelled: true },
      pageSize: 10,
      cursor: null,
      projection: "calendar",
    });

    expect(page.items).toHaveLength(0);
  });
});

// ── Who can read ──────────────────────────────────────────────────────────────

describe("authenticated callers (BUG-014)", () => {
  it("serves players and guardians the same events as the coach", async () => {
    const { coach, teamId } = await setup();
    const ids = await seedEvents(teamId, coach.user.id, evenlySpaced(4));

    const player = await createTestUser();
    await addTeamMember(teamId, player.user.id, "player");

    // A guardian whose only connection to the team is their child's membership:
    // they have no roster row of their own, which is the case that broke
    // recipient resolution in BUG-021 and BUG-007.
    const guardian = await createTestUser();
    const childId = await createManagedProfile(guardian.user.id, { relationship: "dad" });
    await addTeamMember(teamId, childId, "player");

    const coachView = await traverse(coach.client, teamId, 3);
    const playerView = await traverse(player.client, teamId, 3);
    const guardianView = await traverse(guardian.client, teamId, 3);

    expect(coachView.sort()).toEqual([...ids].sort());
    expect(playerView.sort()).toEqual([...ids].sort());
    expect(guardianView.sort()).toEqual([...ids].sort());
  });
});

// ── Complete range reads, for the calendar ────────────────────────────────────

describe("reading a whole month (BUG-014, spec §6.3)", () => {
  it("returns every event in the range, across transport batches", async () => {
    const { coach, teamId } = await setup();
    await seedEvents(teamId, coach.user.id, evenlySpaced(600, Date.parse("2026-12-01T00:00:00.000Z")));

    const events = await fetchEventRange(coach.client, {
      query: {
        teamId,
        fromInclusive: "2026-12-01T00:00:00.000Z",
        toExclusive: "2027-01-01T00:00:00.000Z",
        includeCancelled: true,
      },
      projection: "calendar",
      batchSize: 250,
    });

    expect(events).toHaveLength(600);
    expect(new Set(events.map((e) => e.id)).size).toBe(600);
  });

  it("raises rather than returning a partial month", async () => {
    const { coach, teamId } = await setup();
    await seedEvents(teamId, coach.user.id, evenlySpaced(5, Date.parse("2027-02-01T00:00:00.000Z")));

    // A month is only usable complete: a half-loaded grid looks like a month
    // with fewer events in it.
    await expect(
      fetchEventRange(coach.client, {
        query: {
          teamId,
          fromInclusive: "2027-02-01T00:00:00.000Z",
          toExclusive: "2027-03-01T00:00:00.000Z",
          includeCancelled: true,
        },
        projection: "calendar",
        batchSize: 2,
        maxBatches: 1,
      })
    ).rejects.toBeInstanceOf(IncompleteRangeError);
  });
});

// ── Two filters that both use `or` ────────────────────────────────────────────

describe("the cancellation filter and the cursor together (BUG-014)", () => {
  it("keeps cancelled events out on every page, not just the first", async () => {
    const { coach, teamId } = await setup();
    // Interleaved, so a cancelled row sits at a page boundary.
    await seedEvents(
      teamId,
      coach.user.id,
      Array.from({ length: 12 }, (_, i) => ({
        startTime: new Date(BASE + i * HOUR_MS).toISOString(),
        cancelled: i % 2 === 1,
      }))
    );

    // Both the cancellation predicate and the keyset are PostgREST `or` filters.
    // They have to combine as AND: if they merged into one disjunction, cancelled
    // events would reappear, or the page would stop advancing.
    const seen: string[] = [];
    let cursor: EventCursor | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const page = await fetchEventPage(coach.client, {
        query: { teamId, includeCancelled: false },
        pageSize: 2,
        cursor,
        projection: "calendar",
      });
      expect(page.items.every((e) => e.is_cancelled !== true)).toBe(true);
      seen.push(...page.items.map((e) => e.id));
      if (!page.hasNext) break;
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it("combines a date range, a type and a cursor without losing any of them", async () => {
    const { coach, teamId } = await setup();
    const from = Date.parse("2027-04-01T00:00:00.000Z");
    await seedEvents(teamId, coach.user.id, [
      ...Array.from({ length: 5 }, (_, i) => ({
        startTime: new Date(from + i * HOUR_MS).toISOString(),
        type: "game",
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        startTime: new Date(from + i * HOUR_MS).toISOString(),
        type: "practice",
      })),
      { startTime: "2027-05-02T00:00:00.000Z", type: "game" },
    ]);

    const query = {
      teamId,
      fromInclusive: "2027-04-01T00:00:00.000Z",
      toExclusive: "2027-05-01T00:00:00.000Z",
      eventType: "game" as const,
      includeCancelled: false,
    };
    const first = await fetchEventPage(coach.client, {
      query,
      pageSize: 3,
      cursor: null,
      projection: "calendar",
    });
    const second = await fetchEventPage(coach.client, {
      query,
      pageSize: 3,
      cursor: first.nextCursor,
      projection: "calendar",
    });

    const all = [...first.items, ...second.items];
    expect(all).toHaveLength(5);
    expect(all.every((e) => e.event_type === "game")).toBe(true);
    expect(second.hasNext).toBe(false);
  });
});

// ── The deployment's row cap ──────────────────────────────────────────────────

describe("the environment's row cap (BUG-014, spec §4.2)", () => {
  it("can return a full page plus its lookahead", async () => {
    const { coach, teamId } = await setup();
    const needed = MAX_PAGE_SIZE + 1;
    await seedEvents(teamId, coach.user.id, evenlySpaced(needed, Date.parse("2027-06-01T00:00:00.000Z")));

    // A cap below this would truncate a full page and look like the end of the
    // table. That is a broken environment, not a passing test.
    const { data, error } = await coach.client
      .from("events")
      .select("id")
      .eq("team_id", teamId)
      .order("start_time")
      .order("id")
      .limit(needed);

    expect(error).toBeNull();
    expect(data).toHaveLength(needed);
  });
});
