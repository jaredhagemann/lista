/**
 * The calendar's month cache (BUG-014, spec §6.3 and §9).
 *
 * The calendar used to be handed every event the team had ever held. Now it
 * reads the month it is showing and keeps a few neighbours, which means the
 * cache has to answer some awkward questions honestly: an empty month is a
 * result, a late response must not repopulate a cache that has been thrown
 * away, and a prefetch that fails must be invisible.
 */

import { describe, it, expect, vi } from "vitest";
import { createMonthLoader } from "@/lib/events/month-cache";

type Row = { id: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const rows = (id: string): Row[] => [{ id }];

/** Lets queued background work start. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("loading a month", () => {
  it("reads a month once, then serves it from memory", async () => {
    const read = vi.fn(async (key: string) => rows(key));
    const loader = createMonthLoader<Row>({ read });

    expect(await loader.load("2026-12")).toEqual(rows("2026-12"));
    expect(await loader.load("2026-12")).toEqual(rows("2026-12"));

    expect(read).toHaveBeenCalledTimes(1);
    expect(loader.peek("2026-12")).toEqual(rows("2026-12"));
  });

  it("remembers that a month is empty", async () => {
    const read = vi.fn(async () => [] as Row[]);
    const loader = createMonthLoader<Row>({ read });

    await loader.load("2027-07");
    await loader.load("2027-07");

    // A month with nothing in it is an answer, not a cache miss.
    expect(read).toHaveBeenCalledTimes(1);
    expect(loader.peek("2027-07")).toEqual([]);
  });

  it("passes a failure to the caller and caches nothing", async () => {
    const read = vi.fn(async () => {
      throw new Error("network");
    });
    const loader = createMonthLoader<Row>({ read });

    await expect(loader.load("2026-12")).rejects.toThrow("network");
    expect(loader.peek("2026-12")).toBeUndefined();
  });

  it("shares one request between simultaneous callers", async () => {
    const pending = deferred<Row[]>();
    const read = vi.fn(() => pending.promise);
    const loader = createMonthLoader<Row>({ read });

    const first = loader.load("2026-12");
    const second = loader.load("2026-12");
    pending.resolve(rows("2026-12"));

    expect(await first).toEqual(await second);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("keeping the cache small", () => {
  it("evicts the least recently used month past the limit", async () => {
    const read = vi.fn(async (key: string) => rows(key));
    const loader = createMonthLoader<Row>({ read, maxEntries: 3 });

    await loader.load("2026-01");
    await loader.load("2026-02");
    await loader.load("2026-03");
    // Touching January makes February the least recently used.
    await loader.load("2026-01");
    await loader.load("2026-04");

    expect(loader.peek("2026-02")).toBeUndefined();
    expect(loader.peek("2026-01")).toBeDefined();
    expect(loader.peek("2026-03")).toBeDefined();
    expect(loader.peek("2026-04")).toBeDefined();
  });
});

describe("prefetching neighbours", () => {
  it("fills the cache in the background", async () => {
    const read = vi.fn(async (key: string) => rows(key));
    const loader = createMonthLoader<Row>({ read });

    await loader.load("2026-12");
    await loader.prefetch("2027-01");

    expect(loader.peek("2027-01")).toEqual(rows("2027-01"));
  });

  it("never throws when a prefetch fails, and leaves the month unloaded", async () => {
    const read = vi.fn(async (key: string) => {
      if (key === "2027-01") throw new Error("network");
      return rows(key);
    });
    const loader = createMonthLoader<Row>({ read });

    await loader.load("2026-12");
    await expect(loader.prefetch("2027-01")).resolves.toBeUndefined();

    // Selecting that month later is an ordinary load, which may fail loudly.
    expect(loader.peek("2027-01")).toBeUndefined();
    expect(loader.peek("2026-12")).toBeDefined();
  });

  it("runs one background read at a time", async () => {
    const first = deferred<Row[]>();
    const read = vi.fn((key: string) => (key === "2026-11" ? first.promise : Promise.resolve(rows(key))));
    const loader = createMonthLoader<Row>({ read });

    const a = loader.prefetch("2026-11");
    const b = loader.prefetch("2027-01");
    await tick();

    // The second waits rather than piling on: background work is queued, so the
    // first read is in flight and the second has not started.
    expect(read).toHaveBeenCalledTimes(1);
    first.resolve(rows("2026-11"));
    await Promise.all([a, b]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("lets navigation past a prefetch that is still running", async () => {
    const slow = deferred<Row[]>();
    const read = vi.fn((key: string) => (key === "2026-11" ? slow.promise : Promise.resolve(rows(key))));
    const loader = createMonthLoader<Row>({ read });

    const background = loader.prefetch("2026-11");
    // The user clicks through to January while November is still in flight.
    expect(await loader.load("2027-01")).toEqual(rows("2027-01"));

    slow.resolve(rows("2026-11"));
    await background;
  });
});

describe("throwing the cache away", () => {
  it("forgets everything and reads again", async () => {
    const read = vi.fn(async (key: string) => rows(key));
    const loader = createMonthLoader<Row>({ read });

    await loader.load("2026-12");
    loader.invalidate();

    expect(loader.peek("2026-12")).toBeUndefined();
    await loader.load("2026-12");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not let a read that started earlier repopulate it", async () => {
    const pending = deferred<Row[]>();
    const read = vi.fn(() => pending.promise);
    const loader = createMonthLoader<Row>({ read });

    const inFlight = loader.load("2026-12");
    // The team changed, or the user signed out, while that request was open.
    loader.invalidate();
    pending.resolve(rows("2026-12"));
    await inFlight.catch(() => undefined);

    // Aborting is not enough on its own: a resolved request must still be ignored.
    expect(loader.peek("2026-12")).toBeUndefined();
  });

  it("tells the caller its generation, so late results can be discarded", async () => {
    const read = vi.fn(async (key: string) => rows(key));
    const loader = createMonthLoader<Row>({ read });

    const before = loader.generation();
    loader.invalidate();

    expect(loader.generation()).not.toBe(before);
  });
});

describe("staying fresh", () => {
  it("serves a recent month from memory without asking again", async () => {
    let now = 1_000_000;
    const read = vi.fn(async (key: string) => rows(key));
    const loader = createMonthLoader<Row>({ read, freshFor: 60_000, now: () => now });

    await loader.load("2026-12");
    now += 30_000;
    await loader.load("2026-12");

    expect(read).toHaveBeenCalledTimes(1);
    expect(loader.isStale("2026-12")).toBe(false);
  });

  it("reads a month again once it has gone stale", async () => {
    let now = 1_000_000;
    const read = vi.fn(async (key: string) => rows(key));
    const loader = createMonthLoader<Row>({ read, freshFor: 60_000, now: () => now });

    await loader.load("2026-12");
    // Long enough for someone else to have moved an event.
    now += 61_000;

    expect(loader.isStale("2026-12")).toBe(true);
    await loader.load("2026-12");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("still offers the stale rows while the new ones are on their way", async () => {
    let now = 1_000_000;
    const pending = deferred<Row[]>();
    let call = 0;
    const read = vi.fn(() => {
      call++;
      return call === 1 ? Promise.resolve(rows("first")) : pending.promise;
    });
    const loader = createMonthLoader<Row>({ read, freshFor: 60_000, now: () => now });

    await loader.load("2026-12");
    now += 61_000;

    // Showing something known-but-old beats showing nothing.
    expect(loader.peek("2026-12")).toEqual(rows("first"));

    const refreshed = loader.revalidate("2026-12");
    pending.resolve(rows("second"));
    expect(await refreshed).toEqual(rows("second"));
    expect(loader.peek("2026-12")).toEqual(rows("second"));
    expect(loader.isStale("2026-12")).toBe(false);
  });

  it("treats a month it has never read as stale", () => {
    const loader = createMonthLoader<Row>({ read: async (key) => rows(key) });

    expect(loader.isStale("2026-12")).toBe(true);
  });

  it("keeps the old rows when a revalidation fails", async () => {
    let call = 0;
    const read = vi.fn(() => {
      call++;
      if (call === 1) return Promise.resolve(rows("first"));
      return Promise.reject(new Error("network"));
    });
    const loader = createMonthLoader<Row>({ read });

    await loader.load("2026-12");
    await expect(loader.revalidate("2026-12")).rejects.toThrow("network");

    // A failed refresh is not a reason to blank a month that did load.
    expect(loader.peek("2026-12")).toEqual(rows("first"));
  });
});
