/**
 * The availability roster cache (BUG-014, spec §7.2).
 *
 * The roster belongs to the team, not to the page of events on screen. Reading
 * it again for every ten-event step repeats every transport batch, profile join
 * and policy check, and the matrix waits for all of it before it can show a
 * single response. So it is cached separately from the event pages, under the
 * team it belongs to.
 *
 * The rules that make that safe, and the reasons for them:
 *
 *   - only a successful read is remembered; a failure that cached itself would
 *     render as a team with nobody on it
 *   - one request serves everyone waiting on it
 *   - a read that started before the cache was thrown away cannot refill it,
 *     because aborting a request does not un-resolve one already in flight
 *   - a copy goes stale, so someone joining the team becomes visible without a
 *     reload, and `invalidate()` covers the changes that cannot wait for that
 */

export type RosterCache<T> = {
  /** What is already in memory, fresh or not, without asking for anything. */
  peek(teamId: string): T[] | undefined;
  /** True when this team is missing or old enough to be worth reading again. */
  isStale(teamId: string): boolean;
  /** The roster, from memory if fresh, otherwise from the database. */
  load(teamId: string): Promise<T[]>;
  /** Throws the cache away and orphans anything in flight. */
  invalidate(): void;
};

/** Spec §9: a complete read is good for a minute, then checked again. */
const DEFAULT_FRESH_FOR_MS = 60_000;

export function createRosterCache<T>(options: {
  read: (teamId: string) => Promise<T[]>;
  freshFor?: number;
  now?: () => number;
}): RosterCache<T> {
  const { read, freshFor = DEFAULT_FRESH_FOR_MS, now = Date.now } = options;

  const entries = new Map<string, { rows: T[]; fetchedAt: number }>();
  const inFlight = new Map<string, Promise<T[]>>();
  let generation = 0;

  function peek(teamId: string) {
    return entries.get(teamId)?.rows;
  }

  function isStale(teamId: string) {
    const entry = entries.get(teamId);
    return entry === undefined || now() - entry.fetchedAt >= freshFor;
  }

  function load(teamId: string): Promise<T[]> {
    const entry = entries.get(teamId);
    if (entry !== undefined && !isStale(teamId)) return Promise.resolve(entry.rows);

    const existing = inFlight.get(teamId);
    if (existing) return existing;

    const startedAt = generation;
    const request = read(teamId)
      .then((rows) => {
        // The team, or the reader's access to it, may have changed while this
        // ran. Answer the caller that asked, but do not store the answer.
        if (startedAt === generation) entries.set(teamId, { rows, fetchedAt: now() });
        return rows;
      })
      .finally(() => {
        if (inFlight.get(teamId) === request) inFlight.delete(teamId);
      });

    inFlight.set(teamId, request);
    return request;
  }

  function invalidate() {
    generation += 1;
    entries.clear();
    inFlight.clear();
  }

  return { peek, isStale, load, invalidate };
}
