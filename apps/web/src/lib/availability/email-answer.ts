import type { SupabaseClient } from "@supabase/supabase-js";
import { saveAvailability, AVAILABILITY, type AvailabilityStatus } from "@/lib/availability/status";

/**
 * An answer given from an email link (spec: docs/specs/email-upgrade.md §4.7,
 * D7): /dashboard/schedule/<event>?answer=<status>&for=<profile>.
 *
 * Recorded by the event page as it opens, before it reads the answers back.
 * Who may answer for whom is the database's rule (availability RLS: yourself or
 * a player you're a guardian of, on the event's team); a refusal is explained.
 */

export type EmailAnswerNotice =
  | { kind: "recorded"; who: string; status: AvailabilityStatus }
  | { kind: "started" | "cancelled"; who: string }
  | { kind: "refused" };

/** The query parameters the page takes out of its address once it has answered. */
export const EMAIL_ANSWER_PARAMS = ["answer", "for", "switched"];

const STATUSES = Object.keys(AVAILABILITY) as AvailabilityStatus[];

export function isAnswer(value: unknown): value is AvailabilityStatus {
  return typeof value === "string" && (STATUSES as string[]).includes(value);
}

export async function recordEmailAnswer(
  // The page's own client: the viewer's session, so RLS decides.
  supabase: SupabaseClient,
  {
    event,
    answer,
    forProfileId,
    userId,
    now = new Date(),
  }: {
    event: { id: string; start_time: string; is_cancelled: boolean | null };
    answer: AvailabilityStatus;
    forProfileId: string;
    userId: string;
    now?: Date;
  }
): Promise<EmailAnswerNotice> {
  const who = forProfileId === userId ? "You" : await firstName(supabase, forProfileId);

  if (event.is_cancelled) return { kind: "cancelled", who };
  if (new Date(event.start_time).getTime() <= now.getTime()) return { kind: "started", who };

  const { error } = await saveAvailability(supabase, event.id, forProfileId, answer);
  if (error) return { kind: "refused" };
  return { kind: "recorded", who, status: answer };
}

async function firstName(supabase: SupabaseClient, profileId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("first_name").eq("id", profileId).maybeSingle();
  return (data as { first_name?: string | null } | null)?.first_name?.trim() || "This player";
}

/** What the banner says. */
export function describeEmailAnswer(notice: EmailAnswerNotice): string {
  if (notice.kind === "refused") {
    return "We couldn't record that answer. You can answer for yourself and your own players below.";
  }
  const you = notice.who === "You";
  if (notice.kind === "recorded") {
    return `${you ? "You're" : `${notice.who} is`} marked ${AVAILABILITY[notice.status].label}. You can change it below.`;
  }
  const whose = you ? "your" : `${notice.who}'s`;
  return notice.kind === "started"
    ? `This event has already started, so ${whose} answer wasn't recorded.`
    : `This event was cancelled, so ${whose} answer wasn't recorded.`;
}
