/**
 * The zone the calendar reads dates in (BUG-014 follow-up).
 *
 * A team that has never set a timezone used to fall back to UTC, which put a
 * 4:00 PM Pacific event — 00:00 UTC the next day — on the wrong square. Before
 * the pagination work the grid grouped by the browser's local date, so the same
 * team looked correct to anyone in the team's own city and wrong to nobody who
 * noticed.
 *
 * The fallback is now the viewer's own zone, and the calendar says so. That is a
 * deliberate departure from "never depend on the browser zone": depending on it
 * *silently* is the part that hurts, and two viewers in different cities really
 * can disagree about which day an event falls on until the team's zone is set.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Db = SupabaseClient<Database>;

/** A real IANA zone, or null if this environment cannot name one. */
export function browserTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return null;
    // Round-trip it: a name this engine cannot format is no use to the grid.
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

export type TimeZoneUpdate = { ok: true } | { ok: false; message: string };

/**
 * Records the team's timezone.
 *
 * Only team admins may write it, and an update the policy refuses matches no
 * rows **without raising** — so this checks what came back rather than trusting
 * the absence of an error. That silence is what made a push registration fail
 * unnoticed in BUG-023.
 */
export async function updateTeamTimeZone(
  client: Db,
  teamId: string,
  timeZone: string
): Promise<TimeZoneUpdate> {
  const { data, error } = await client
    .from("teams")
    .update({ timezone: timeZone })
    .eq("id", teamId)
    .select("id, timezone");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      message: "You don't have permission to change this team's timezone.",
    };
  }
  return { ok: true };
}
