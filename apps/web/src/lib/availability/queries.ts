/**
 * Availability reads for a displayed page of events (BUG-014, spec §7.1).
 *
 * The matrix used to fetch every response in a two-year window before showing
 * ten events. Two things went wrong with that: the rows exceeded the API cap and
 * were silently truncated, and every event id in the window went into one GET
 * filter, which the gateway rejected with "URI too long" somewhere past 300 ids.
 *
 * Responses are now read for the events actually on screen — at most twenty —
 * and paged on `(event_id, profile_id)`, the pair that already forms the unique
 * response key. A read either completes or raises: a missing response renders as
 * "no response", which is indistinguishable from a player who declined to answer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Db = SupabaseClient<Database>;

export type ResponseStatus = "available" | "maybe" | "unavailable";

export type ResponseRow = {
  event_id: string;
  profile_id: string;
  status: ResponseStatus;
};

export type RosterMember = {
  profileId: string;
  role: string;
  name: string;
};

export class AvailabilityQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvailabilityQueryError";
  }
}

/**
 * The ceiling on ids in one request filter. A displayed page is at most twenty
 * events; anything approaching this means a caller is reaching for a whole
 * window again, which is what put every season event into a URL before.
 */
export const MAX_EVENT_IDS = 50;

const DEFAULT_BATCH_SIZE = 500;
const API_MAX_ROWS = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ResponseCursor = { eventId: string; profileId: string };

/** `(event_id, profile_id) > (cursor)`, in PostgREST's syntax. */
function keysetFilter(cursor: ResponseCursor): string {
  return `event_id.gt.${cursor.eventId},and(event_id.eq.${cursor.eventId},profile_id.gt.${cursor.profileId})`;
}

/**
 * Every response for these events, complete.
 *
 * Batches are keyed rather than offset: a player clearing a response mid-read
 * would shift an offset past a row that still exists.
 */
export async function fetchResponsesForEvents(
  client: Db,
  eventIds: string[],
  options: { batchSize?: number } = {}
): Promise<ResponseRow[]> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  if (batchSize + 1 > API_MAX_ROWS) {
    throw new AvailabilityQueryError(
      `A batch of ${batchSize} needs ${batchSize + 1} rows, past the API cap of ${API_MAX_ROWS}`
    );
  }
  if (eventIds.length > MAX_EVENT_IDS) {
    throw new AvailabilityQueryError(
      `Asked for ${eventIds.length} events at once; read the events on screen (at most ${MAX_EVENT_IDS}), not a whole window`
    );
  }
  for (const id of eventIds) {
    if (!UUID.test(id)) throw new AvailabilityQueryError(`Not an event id: ${id}`);
  }
  // No events on screen is not a query.
  if (eventIds.length === 0) return [];

  const rows: ResponseRow[] = [];
  let cursor: ResponseCursor | null = null;

  for (let batch = 0; ; batch++) {
    let request = client
      .from("availability")
      .select("event_id, profile_id, status")
      .in("event_id", eventIds)
      .order("event_id", { ascending: true })
      .order("profile_id", { ascending: true })
      .limit(batchSize + 1);

    if (cursor) request = request.or(keysetFilter(cursor));

    const { data, error } = await request;
    if (error) {
      throw new AvailabilityQueryError(`Could not read responses: ${error.message}`);
    }

    const page = (data ?? []).filter(
      (r): r is ResponseRow => r.event_id != null && r.profile_id != null
    );
    const hasNext = page.length > batchSize;
    const items = hasNext ? page.slice(0, batchSize) : page;
    rows.push(...items);

    if (!hasNext) return rows;

    const last = items[items.length - 1];
    if (!last) {
      // A full page of rows we cannot key from would loop forever.
      throw new AvailabilityQueryError("Response page ended without a usable cursor");
    }
    cursor = { eventId: last.event_id, profileId: last.profile_id };
  }
}

/**
 * The team's roster, complete, ordered for display only once it is all here.
 *
 * Membership rows without a profile are skipped rather than rendered as an
 * unnamed player.
 */
export async function fetchTeamRoster(
  client: Db,
  teamId: string,
  options: { batchSize?: number } = {}
): Promise<RosterMember[]> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  if (!UUID.test(teamId)) {
    throw new AvailabilityQueryError(`Not a team id: ${teamId}`);
  }

  const members: RosterMember[] = [];
  let cursor: string | null = null;

  for (;;) {
    let request = client
      .from("team_members")
      .select("profile_id, role, profiles(first_name, last_name)")
      .eq("team_id", teamId)
      .order("profile_id", { ascending: true })
      .limit(batchSize + 1);

    // profile_id is unique within a team, so it orders the roster on its own.
    if (cursor) request = request.gt("profile_id", cursor);

    const { data, error } = await request;
    if (error) {
      throw new AvailabilityQueryError(`Could not read the roster: ${error.message}`);
    }

    const page = data ?? [];
    const hasNext = page.length > batchSize;
    const items = hasNext ? page.slice(0, batchSize) : page;

    for (const row of items) {
      if (!row.profile_id) continue;
      const profile = row.profiles as unknown as {
        first_name: string | null;
        last_name: string | null;
      } | null;
      members.push({
        profileId: row.profile_id,
        role: row.role,
        name: profile
          ? [profile.first_name, profile.last_name].filter(Boolean).join(" ")
          : "Unknown",
      });
    }

    if (!hasNext) return members;

    const last = items[items.length - 1];
    if (!last?.profile_id) {
      throw new AvailabilityQueryError("Roster page ended without a usable cursor");
    }
    cursor = last.profile_id;
  }
}
