/**
 * Assembling a complete range from several batches (BUG-014, spec §4.4).
 *
 * The spec allows a live view rather than a snapshot, but draws one line: an
 * observed duplicate id inside a supposedly complete read must raise or retry —
 * never be deduplicated and handed on as complete. A calendar month is the case
 * that matters, because a month with an event in it twice, or missing, says
 * nothing about being wrong.
 *
 * The client is stubbed so each batch is exactly what the test intends. Each
 * canned page includes the lookahead row the repository asks for: a page of
 * `batchSize + 1` rows means "there is more", and anything shorter is the end.
 */

import { describe, it, expect } from "vitest";
import { fetchEventRange, IncompleteRangeError } from "@/lib/events/queries";

type Row = { id: string; team_id: string; start_time: string };

const TEAM = "11111111-1111-1111-1111-111111111111";
const RANGE = {
  teamId: TEAM,
  fromInclusive: "2026-12-01T00:00:00.000Z",
  toExclusive: "2027-01-01T00:00:00.000Z",
  includeCancelled: true,
};

function event(n: number, day = n): Row {
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
    team_id: TEAM,
    start_time: `2026-12-${String(day).padStart(2, "0")}T17:00:00.000Z`,
  };
}

/** A client that answers each request with the next canned page. */
function stubClient(pages: { data: Row[] | null; error: { message: string } | null }[]) {
  let call = 0;

  const client = {
    from() {
      const page = pages[Math.min(call, pages.length - 1)];
      call++;
      const chain: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(page).then(resolve, reject),
      };
      for (const method of ["select", "eq", "gte", "lt", "or", "order", "limit"]) {
        chain[method] = () => chain;
      }
      return chain;
    },
  };

  return { client: client as never, requests: () => call };
}

const ok = (rows: Row[]) => ({ data: rows, error: null });

describe("reading a complete range (BUG-014)", () => {
  it("joins the batches in order", async () => {
    // Three rows for a batch of two: two events and the lookahead.
    const { client } = stubClient([ok([event(1), event(2), event(3)]), ok([event(3)])]);

    const events = await fetchEventRange(client, {
      query: RANGE,
      projection: "calendar",
      batchSize: 2,
    });

    expect(events.map((e) => e.id)).toEqual([event(1).id, event(2).id, event(3).id]);
  });

  it("raises when a later batch fails, rather than returning the earlier ones", async () => {
    const { client } = stubClient([
      ok([event(1), event(2), event(3)]),
      { data: null, error: { message: "connection reset" } },
    ]);

    await expect(
      fetchEventRange(client, { query: RANGE, projection: "calendar", batchSize: 2 })
    ).rejects.toBeInstanceOf(IncompleteRangeError);
  });

  it("refuses a range where an event came back twice", async () => {
    // What an event moved forward across the cursor looks like: the same id in
    // two batches, with two different start times.
    const moved = { ...event(1), start_time: "2026-12-09T17:00:00.000Z" };
    const { client } = stubClient([ok([event(1), event(2), event(3)]), ok([event(3), moved])]);

    const attempt = fetchEventRange(client, {
      query: RANGE,
      projection: "calendar",
      batchSize: 2,
      maxAttempts: 1,
    });

    await expect(attempt).rejects.toBeInstanceOf(IncompleteRangeError);
    await expect(attempt).rejects.toThrow(/twice/i);
  });

  it("retries the whole range once before giving up on a duplicate", async () => {
    const moved = { ...event(1), start_time: "2026-12-09T17:00:00.000Z" };
    const { client, requests } = stubClient([
      // The first attempt sees the moved event twice…
      ok([event(1), event(2), event(3)]),
      ok([event(3), moved]),
      // …and the retry sees a settled table.
      ok([event(2), event(3), moved]),
      ok([moved]),
    ]);

    const events = await fetchEventRange(client, {
      query: RANGE,
      projection: "calendar",
      batchSize: 2,
      maxAttempts: 2,
    });

    expect(events.map((e) => e.id)).toEqual([event(2).id, event(3).id, moved.id]);
    expect(requests()).toBe(4);
  });

  it("gives up after the last attempt rather than returning inconsistent data", async () => {
    const moved = { ...event(1), start_time: "2026-12-09T17:00:00.000Z" };
    // Both attempts see the same inconsistency.
    const { client } = stubClient([
      ok([event(1), event(2), event(3)]),
      ok([event(3), moved]),
      ok([event(1), event(2), event(3)]),
      ok([event(3), moved]),
    ]);

    await expect(
      fetchEventRange(client, {
        query: RANGE,
        projection: "calendar",
        batchSize: 2,
        maxAttempts: 2,
      })
    ).rejects.toBeInstanceOf(IncompleteRangeError);
  });

  it("stops at the batch ceiling instead of reading forever", async () => {
    const { client } = stubClient([
      ok([event(1), event(2), event(3)]),
      ok([event(4), event(5), event(6)]),
    ]);

    await expect(
      fetchEventRange(client, {
        query: RANGE,
        projection: "calendar",
        batchSize: 2,
        maxBatches: 2,
        maxAttempts: 1,
      })
    ).rejects.toBeInstanceOf(IncompleteRangeError);
  });
});
