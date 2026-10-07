import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AnswerRow, AvailabilityStatus } from "@/emails/event-email";
import { effectiveAnswer } from "@/lib/availability/effective";

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
  /**
   * For a game in a tournament: the tournament's answers, which a person's game
   * answer follows until they set one (docs/specs/tournaments-and-leagues.md §4,
   * D19), and its title, for "from Surf Cup".
   */
  tournament?: { title: string; statusOf: Map<string, AvailabilityStatus> };
};

type Answer = { profile_id: string | null; status: string };

function statusMap(answers: Answer[] | null): Map<string, AvailabilityStatus> {
  const map = new Map<string, AvailabilityStatus>();
  for (const answer of answers ?? []) {
    if (answer.profile_id && STATUSES.includes(answer.status as AvailabilityStatus)) {
      map.set(answer.profile_id, answer.status as AvailabilityStatus);
    }
  }
  return map;
}

export async function loadAnswerContext(
  db: Db,
  eventId: string,
  profileIds: string[],
  /** A game's tournament, when it's in one: its answers are read too (D19). */
  tournament?: { id: string; title: string } | null
): Promise<AnswerContext> {
  const ids = [...new Set(profileIds)];
  if (ids.length === 0) return { statusOf: new Map(), nameOf: new Map() };

  const [{ data: answers }, { data: profiles }, tournamentAnswers] = await Promise.all([
    db.from("availability").select("profile_id, status").eq("event_id", eventId).in("profile_id", ids),
    db.from("profiles").select("id, first_name").in("id", ids),
    tournament
      ? db.from("availability").select("profile_id, status").eq("event_id", tournament.id).in("profile_id", ids)
      : Promise.resolve(null),
  ]);

  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.first_name?.trim() || "Player"]));
  return {
    statusOf: statusMap(answers),
    nameOf,
    ...(tournament && tournamentAnswers
      ? { tournament: { title: tournament.title, statusOf: statusMap(tournamentAnswers.data) } }
      : {}),
  };
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
  const rows = recipient.coversProfileIds.map((profileId) => {
    // Their answer for this event, else the tournament's it follows (D19).
    const answer = effectiveAnswer(context.statusOf.get(profileId), context.tournament?.statusOf.get(profileId));
    return {
      profileId,
      name: context.nameOf.get(profileId) ?? "Player",
      isRecipient: profileId === recipient.profileId,
      status: answer.status,
      inheritedFrom: answer.inherited ? (context.tournament?.title ?? null) : null,
      links: Object.fromEntries(
        STATUSES.map((status) => [status, `${eventUrl}?${new URLSearchParams({ answer: status, for: profileId })}`])
      ) as Record<AvailabilityStatus, string>,
    };
  });
  return rows.sort((a, b) => Number(b.isRecipient) - Number(a.isRecipient) || a.name.localeCompare(b.name));
}
