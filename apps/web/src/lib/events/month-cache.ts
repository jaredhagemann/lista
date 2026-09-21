/**
 * The calendar's month cache (BUG-014, spec §6.3 and §9).
 *
 * The calendar reads the month it is showing and keeps a few neighbours, rather
 * than being handed the team's whole history. The rules that make that safe:
 *
 *   - an empty month is a result and is cached; only a failure is a miss
 *   - one request per month, however many callers ask at once
 *   - a prefetch never throws and never blocks the month the user is looking at
 *   - a read that started before the cache was thrown away cannot repopulate it,
 *     because aborting a request does not un-resolve one already in flight
 *   - a month goes stale: memory bounds how much is kept, not how old it is, and
 *     someone else moving an event should not stay invisible while the calendar
 *     sits open
 */

export type MonthLoader<T> = {
  /** What is already in memory, fresh or not, without asking for anything. */
  peek(key: string): T[] | undefined;
  /** True when a month is missing or old enough to be worth reading again. */
  isStale(key: string): boolean;
  /** The month, from memory if fresh, otherwise from the database. */
  load(key: string): Promise<T[]>;
  /** Reads the month again even if it is cached. Failures reach the caller. */
  revalidate(key: string): Promise<T[]>;
  /** Fills the cache quietly. Never throws, never takes priority. */
  prefetch(key: string): Promise<void>;
  /** Throws the cache away and orphans anything in flight. */
  invalidate(): void;
  /** Changes on every invalidation, so a caller can discard a late result. */
  generation(): number;
  size(): number;
};

/** Spec §9: complete reads are good for a minute, then checked again. */
const DEFAULT_FRESH_FOR_MS = 60_000;

export function createMonthLoader<T>(options: {
  read: (key: string) => Promise<T[]>;
  /** Spec §6.3: at most six months per identity context. */
  maxEntries?: number;
  freshFor?: number;
  now?: () => number;
}): MonthLoader<T> {
  const { read, maxEntries = 6, freshFor = DEFAULT_FRESH_FOR_MS, now = Date.now } = options;

  // Map preserves insertion order, which is all an LRU needs: delete and
  // re-insert on use, and the oldest key is the first one.
  const entries = new Map<string, { rows: T[]; fetchedAt: number }>();
  const inFlight = new Map<string, Promise<T[]>>();
  let generation = 0;
  let background: Promise<unknown> = Promise.resolve();

  function touch(key: string, entry: { rows: T[]; fetchedAt: number }) {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  function peek(key: string): T[] | undefined {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    // Reading it makes it the most recently used.
    touch(key, entry);
    return entry.rows;
  }

  function isStale(key: string): boolean {
    const entry = entries.get(key);
    if (entry === undefined) return true;
    return now() - entry.fetchedAt >= freshFor;
  }

  function fetchMonth(key: string): Promise<T[]> {
    const existing = inFlight.get(key);
    if (existing) return existing;

    const startedAt = generation;
    const request = read(key)
      .then((rows) => {
        // The cache this read belongs to may be gone: a team switch, a sign-out,
        // a manual refresh. The rows are still returned to whoever asked, so the
        // caller can decide, but they do not go back into a cache that moved on.
        if (startedAt === generation) touch(key, { rows, fetchedAt: now() });
        return rows;
      })
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });

    inFlight.set(key, request);
    return request;
  }

  function load(key: string): Promise<T[]> {
    const cached = peek(key);
    // Old rows are read again; a failure then leaves the old ones in place,
    // which is the caller's cue to show them with a stale marker.
    if (cached !== undefined && !isStale(key)) return Promise.resolve(cached);
    return fetchMonth(key);
  }

  return {
    peek,
    isStale,
    load,
    revalidate: fetchMonth,
    prefetch(key: string): Promise<void> {
      if (inFlight.has(key) || !isStale(key)) return Promise.resolve();

      // Queued behind any other background work, so neighbours are fetched one
      // at a time; a foreground load never waits for this queue.
      background = background
        .catch(() => undefined)
        .then(() => {
          if (inFlight.has(key) || !isStale(key)) return undefined;
          // A failed prefetch is invisible: the month is simply still unloaded,
          // and selecting it later is an ordinary load that may fail loudly.
          return fetchMonth(key).catch(() => undefined);
        });

      return background.then(() => undefined);
    },
    invalidate() {
      generation++;
      entries.clear();
      inFlight.clear();
    },
    generation: () => generation,
    size: () => entries.size,
  };
}
