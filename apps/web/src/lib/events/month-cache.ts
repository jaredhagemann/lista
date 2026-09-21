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
 */

export type MonthLoader<T> = {
  /** What is already in memory, without asking for anything. */
  peek(key: string): T[] | undefined;
  /** The month, from memory or the database. Failures reach the caller. */
  load(key: string): Promise<T[]>;
  /** Fills the cache quietly. Never throws, never takes priority. */
  prefetch(key: string): Promise<void>;
  /** Throws the cache away and orphans anything in flight. */
  invalidate(): void;
  /** Changes on every invalidation, so a caller can discard a late result. */
  generation(): number;
  size(): number;
};

export function createMonthLoader<T>(options: {
  read: (key: string) => Promise<T[]>;
  /** Spec §6.3: at most six months per identity context. */
  maxEntries?: number;
}): MonthLoader<T> {
  const { read, maxEntries = 6 } = options;

  // Map preserves insertion order, which is all an LRU needs: delete and
  // re-insert on use, and the oldest key is the first one.
  const entries = new Map<string, T[]>();
  const inFlight = new Map<string, Promise<T[]>>();
  let generation = 0;
  let background: Promise<unknown> = Promise.resolve();

  function touch(key: string, rows: T[]) {
    entries.delete(key);
    entries.set(key, rows);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  function peek(key: string): T[] | undefined {
    const rows = entries.get(key);
    if (rows === undefined) return undefined;
    // Reading it makes it the most recently used.
    touch(key, rows);
    return rows;
  }

  function load(key: string): Promise<T[]> {
    const cached = peek(key);
    if (cached !== undefined) return Promise.resolve(cached);

    const existing = inFlight.get(key);
    if (existing) return existing;

    const startedAt = generation;
    const request = read(key)
      .then((rows) => {
        // The cache this read belongs to may be gone: a team switch, a sign-out,
        // a manual refresh. The rows are still returned to whoever asked, so the
        // caller can decide, but they do not go back into a cache that moved on.
        if (startedAt === generation) touch(key, rows);
        return rows;
      })
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });

    inFlight.set(key, request);
    return request;
  }

  function prefetch(key: string): Promise<void> {
    if (entries.has(key) || inFlight.has(key)) return Promise.resolve();

    // Queued behind any other background work, so neighbours are fetched one at
    // a time; a foreground load never waits for this queue.
    background = background
      .catch(() => undefined)
      .then(() => {
        if (entries.has(key) || inFlight.has(key)) return undefined;
        // A failed prefetch is invisible: the month is simply still unloaded,
        // and selecting it later is an ordinary load that may fail loudly.
        return load(key).catch(() => undefined);
      });

    return background.then(() => undefined);
  }

  return {
    peek,
    load,
    prefetch,
    invalidate() {
      generation++;
      entries.clear();
      inFlight.clear();
    },
    generation: () => generation,
    size: () => entries.size,
  };
}
