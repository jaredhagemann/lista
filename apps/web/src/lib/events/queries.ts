/**
 * Cursor-based event reads (BUG-014, spec §4).
 *
 * Every view that lists events goes through here, so ordering and continuation
 * are decided once. The rules that matter:
 *
 *   - order by `(start_time, id)`, which is unique; `start_time` alone ties for
 *     simultaneous events, and a tie at a page boundary repeats one row and
 *     skips another
 *   - continue from the last returned row's key, never from an offset: an
 *     offset shifts when a row behind it is deleted, silently skipping a row
 *     that still exists
 *   - ask for one row more than the page, to learn whether a next page exists
 *     without counting the table
 *
 * Callers own their projection and filters; they do not build filter strings.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Db = SupabaseClient<Database>;

export type EventRow = Database["public"]["Tables"]["events"]["Row"];

/**
 * Exactly the columns the calendar projection selects. Typing these reads as a
 * whole `EventRow` advertised fields the query never asked for — `notes` came
 * back undefined while the compiler called it `string | null`.
 */
export type CalendarEventRow = Pick<
  EventRow,
  | "id"
  | "team_id"
  | "title"
  | "event_type"
  | "start_time"
  | "end_time"
  | "is_cancelled"
  | "opponent"
  | "home_away"
  | "uniform"
  | "score_for"
  | "score_against"
>;

/** The list projection: the whole row, plus the joined location summary. */
export type ListEventRow = EventRow & {
  locations: { name: string; address: string | null } | null;
};

/** The row shape a projection returns. Callers do not get to choose it. */
export type RowFor<P extends EventProjection> = P extends "calendar"
  ? CalendarEventRow
  : ListEventRow;

/** A position in the ordered result, carried between pages. */
export type EventCursor = { startTime: string; id: string };

export type EventQuery = {
  teamId: string;
  /** UTC instant; absent means unbounded history. */
  fromInclusive?: string;
  /** UTC instant, exclusive; absent means unbounded future. */
  toExclusive?: string;
  eventType?: "practice" | "game" | "other";
  includeCancelled: boolean;
};

export type EventProjection = "calendar" | "list";


export type CursorPage<T> = {
  items: T[];
  nextCursor: EventCursor | null;
  hasNext: boolean;
};

/** A query that should not be sent: bad input, or a page the API cannot return. */
export class EventQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventQueryError";
  }
}

/** A range read that could not be finished. Never returned as partial data. */
export class IncompleteRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompleteRangeError";
  }
}

/**
 * The deployment's PostgREST row cap. Every request, lookahead included, must
 * fit beneath it — a response truncated by the cap looks exactly like the end of
 * the table, which is the defect this module exists to prevent.
 */
export const API_MAX_ROWS = 1000;
export const MAX_PAGE_SIZE = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Postgres timestamps, including the microseconds JavaScript's Date discards. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/;

const PROJECTIONS: Record<EventProjection, string> = {
  // The grid needs placement and labelling, nothing else. A game is labelled by
  // its team and opponent, with its uniform (spec: game-display-and-uniform-colors).
  calendar:
    "id, team_id, title, event_type, start_time, end_time, is_cancelled, opponent, home_away, uniform, score_for, score_against",
  // The list needs what its rows and row actions read.
  list: "*, locations(name, address)",
};

function assertValid(query: EventQuery, pageSize: number, cursor: EventCursor | null) {
  if (!UUID.test(query.teamId)) {
    throw new EventQueryError(`Not a team id: ${query.teamId}`);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new EventQueryError(`Page size must be 1-${MAX_PAGE_SIZE}, got ${pageSize}`);
  }
  // The lookahead row rides along with the page, so the cap has to cover both.
  if (pageSize + 1 > API_MAX_ROWS) {
    throw new EventQueryError(
      `A page of ${pageSize} needs ${pageSize + 1} rows, past the API cap of ${API_MAX_ROWS}`
    );
  }
  for (const [label, value] of [
    ["fromInclusive", query.fromInclusive],
    ["toExclusive", query.toExclusive],
  ] as const) {
    if (value !== undefined && !TIMESTAMP.test(value)) {
      throw new EventQueryError(`Not a timestamp for ${label}: ${value}`);
    }
  }
  if (query.eventType && !["practice", "game", "other"].includes(query.eventType)) {
    throw new EventQueryError(`Not an event type: ${query.eventType}`);
  }
  if (cursor) {
    if (!UUID.test(cursor.id) || !TIMESTAMP.test(cursor.startTime)) {
      throw new EventQueryError("Cursor is not a valid (start_time, id) position");
    }
  }
}

/**
 * The timestamp as PostgREST wants it inside a filter.
 *
 * The value is passed through as text — never parsed into a Date, which would
 * discard microseconds and make two events a fraction of a millisecond apart
 * indistinguishable. `+00:00` becomes `Z` so the `+` cannot be mistaken for an
 * encoded space, and the value is quoted so its colons and dashes are literal.
 */
function filterTimestamp(value: string): string {
  return `"${value.replace(/\+00:?00$/, "Z")}"`;
}

/** `(start_time, id) > (cursor.startTime, cursor.id)`, in PostgREST's syntax. */
function keysetFilter(cursor: EventCursor): string {
  const t = filterTimestamp(cursor.startTime);
  return `start_time.gt.${t},and(start_time.eq.${t},id.gt.${cursor.id})`;
}

/**
 * One page of events, ordered `(start_time, id)` ascending.
 *
 * `hasNext` comes from a single extra row rather than a count: an exact count on
 * every page load is a second query whose answer is stale as soon as it returns.
 */
export async function fetchEventPage<P extends EventProjection>(
  client: Db,
  args: {
    query: EventQuery;
    pageSize: number;
    cursor: EventCursor | null;
    projection: P;
  }
): Promise<CursorPage<RowFor<P>>> {
  const { query, pageSize, cursor, projection } = args;
  assertValid(query, pageSize, cursor);

  let request = client
    .from("events")
    .select(PROJECTIONS[projection])
    .eq("team_id", query.teamId);

  if (query.fromInclusive) request = request.gte("start_time", query.fromInclusive);
  // Half-open: an event at the next boundary belongs to the next range only.
  if (query.toExclusive) request = request.lt("start_time", query.toExclusive);
  if (query.eventType) request = request.eq("event_type", query.eventType);

  // `is_cancelled` is nullable, and rows predating its default carry null.
  // `.eq(false)` would drop them and quietly change which events appear.
  if (!query.includeCancelled) {
    request = request.or("is_cancelled.is.null,is_cancelled.eq.false");
  }

  if (cursor) {
    // The OR expresses the keyset exactly, but Postgres cannot use an OR as an
    // index *start* condition: it scans the team from the beginning and filters.
    // Measured on 20,000 events, page 40 read 6,010 rows to return 251. This
    // redundant lower bound — implied by the OR, never contradicting it —
    // restores the index start condition: 251 rows read, nothing filtered.
    request = request.gte("start_time", cursor.startTime).or(keysetFilter(cursor));
  }

  const { data, error } = await request
    .order("start_time", { ascending: true })
    .order("id", { ascending: true })
    .limit(pageSize + 1);

  if (error) {
    throw new EventQueryError(`Could not read events: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as (RowFor<P> & { start_time: string; id: string })[];
  const hasNext = rows.length > pageSize;
  const items = hasNext ? rows.slice(0, pageSize) : rows;
  const last = items[items.length - 1];

  return {
    items: items as RowFor<P>[],
    // The cursor is the last *returned* row, not the lookahead one.
    nextCursor: hasNext && last ? { startTime: last.start_time, id: last.id } : null,
    hasNext,
  };
}

/**
 * Every event in a bounded range — a calendar month — read in batches.
 *
 * Returns only when the whole range has been read. A batch that fails raises,
 * because a partially loaded month renders as a month with fewer events in it,
 * and nothing on screen says otherwise.
 */
export async function fetchEventRange<P extends EventProjection>(
  client: Db,
  args: {
    query: EventQuery;
    projection: P;
    batchSize?: number;
    /** Guards against an unbounded loop; exceeding it is an error, not a truncation. */
    maxBatches?: number;
    /** Whole-range retries when a concurrent edit makes the batches inconsistent. */
    maxAttempts?: number;
  }
): Promise<RowFor<P>[]> {
  const { query, projection, batchSize = 250, maxBatches = 40, maxAttempts = 2 } = args;

  if (!query.fromInclusive || !query.toExclusive) {
    throw new EventQueryError("A range read needs both bounds");
  }

  let lastInconsistency: string | null = null;

  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
    try {
      return await readRangeOnce<P>(client, { query, projection, batchSize, maxBatches });
    } catch (error) {
      // An edit landing mid-read is worth one more look; anything else is not.
      if (error instanceof InconsistentRangeError) {
        lastInconsistency = error.message;
        continue;
      }
      throw error;
    }
  }

  throw new IncompleteRangeError(
    `Range still inconsistent after ${maxAttempts} attempts: ${lastInconsistency}`
  );
}

/** Internal: signals a retryable inconsistency rather than a failed read. */
class InconsistentRangeError extends Error {}

async function readRangeOnce<P extends EventProjection>(
  client: Db,
  args: {
    query: EventQuery;
    projection: P;
    batchSize: number;
    maxBatches: number;
  }
): Promise<RowFor<P>[]> {
  const { query, projection, batchSize, maxBatches } = args;

  const items: RowFor<P>[] = [];
  const seen = new Set<string>();
  let cursor: EventCursor | null = null;

  for (let batch = 0; batch < maxBatches; batch++) {
    let page: CursorPage<RowFor<P>>;
    try {
      page = await fetchEventPage<P>(client, {
        query,
        pageSize: batchSize,
        cursor,
        projection,
      });
    } catch (error) {
      throw new IncompleteRangeError(
        `Could not read the whole range: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }

    for (const item of page.items) {
      const id = (item as { id: string }).id;
      // The same event in two batches means it moved across the cursor while we
      // were reading. Deduplicating and calling the range complete would hide
      // that another event may have moved the other way, out of the read.
      if (seen.has(id)) {
        throw new InconsistentRangeError("Event " + id + " was returned twice while reading the range");
      }
      seen.add(id);
      items.push(item);
    }

    if (!page.hasNext) return items;

    const next = page.nextCursor;
    if (
      !next ||
      (cursor && next.startTime === cursor.startTime && next.id === cursor.id)
    ) {
      throw new InconsistentRangeError("Range cursor stopped advancing");
    }
    cursor = next;
  }

  throw new IncompleteRangeError(
    `Range needs more than ${maxBatches} batches of ${batchSize}; narrow it rather than reading it all`
  );
}
