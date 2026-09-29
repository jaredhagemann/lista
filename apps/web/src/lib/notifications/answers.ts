import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AnswerRow, AvailabilityStatus } from "@/emails/event-email";

/**
 * The answer rows in an event email (spec: docs/specs/email-upgrade.md §4.7,
 * D7–D10): one per person the recipient answers for, with that person's current
 * answer and links that record an answer on the event page.
 *
 * The event's answers and the names of everyone covered are read once per
 * event; each recipient's rows are then picked from them.
 */

type Db = SupabaseClient<Database>;

const STATUSES: AvailabilityStatus[] = ["available", "maybe", "unavailable"];

export type AnswerContext = {
  statusOf: Map<string, AvailabilityStatus>;
  nameOf: Map<string, string>;
};

export async function loadAnswerContext(db: Db, eventId: string, profileIds: string[]): Promise<AnswerContext> {
  const ids = [...new Set(profileIds)];
  if (ids.length === 0) return { statusOf: new Map(), nameOf: new Map() };

  const [{ data: answers }, { data: profiles }] = await Promise.all([
    db.from("availability").select("profile_id, status").eq("event_id", eventId).in("profile_id", ids),
    db.from("profiles").select("id, first_name").in("id", ids),
  ]);

  const statusOf = new Map<string, AvailabilityStatus>();
  for (const answer of answers ?? []) {
    if (answer.profile_id && STATUSES.includes(answer.status as AvailabilityStatus)) {
      statusOf.set(answer.profile_id, answer.status as AvailabilityStatus);
    }
  }
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.first_name?.trim() || "Player"]));
  return { statusOf, nameOf };
}

/**
 * A recipient's rows: themselves first when they're on the team, then the
 * players they answer for, by name. Each link opens the event page and records
 * that answer for that person, once they've signed in.
 */
export function answerRowsFor(
  recipient: { profileId: string; coversProfileIds: string[] },
  context: AnswerContext,
  eventUrl: string
): AnswerRow[] {
  const rows = recipient.coversProfileIds.map((profileId) => ({
    profileId,
    name: context.nameOf.get(profileId) ?? "Player",
    isRecipient: profileId === recipient.profileId,
    status: context.statusOf.get(profileId) ?? null,
    links: Object.fromEntries(
      STATUSES.map((status) => [status, `${eventUrl}?${new URLSearchParams({ answer: status, for: profileId })}`])
    ) as Record<AvailabilityStatus, string>,
  }));
  return rows.sort((a, b) => Number(b.isRecipient) - Number(a.isRecipient) || a.name.localeCompare(b.name));
}
