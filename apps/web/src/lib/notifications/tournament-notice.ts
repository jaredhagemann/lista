/**
 * How a tournament's notices read (docs/specs/tournaments-and-leagues.md §4,
 * "Notifications"; part 2c).
 *
 * A tournament-wide action sends one notice that reads as a tournament, never as
 * a series: its dates, never midnight-to-midnight times, and what happened to
 * its games. Where it links follows today's rule for single events: the
 * tournament's page, unless it's gone.
 */

import type { EventSnapshot, NotificationJob, TournamentGamesSummary } from "@/lib/notifications/dispatch";
import { tournamentDates } from "@/lib/events/tournament";
import { TEAM_BRAND_COLUMNS } from "@/emails/brand";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A tournament's own notice, by its type, whatever the job's count. */
export function isTournamentSnapshot(snapshot: Pick<EventSnapshot, "event_type">): boolean {
  return snapshot.event_type === "tournament";
}

/** The tournament's page, or the schedule once it's been deleted. */
export function tournamentNoticeUrl(job: Pick<NotificationJob, "action" | "event_id">, appUrl: string): string {
  return job.action === "deleted" || !job.event_id
    ? `${appUrl}/dashboard/schedule`
    : `${appUrl}/dashboard/schedule/${job.event_id}`;
}

/** What happened to its games, in a phrase: "2 games", "its 2 remaining games are cancelled too". */
function gamesPhrase(summary: TournamentGamesSummary): string | null {
  switch (summary.games_action) {
    case "created":
      return summary.games > 0 ? plural(summary.games, "game", "games") : null;
    case "cancelled":
      if (summary.affected === 0) return null;
      return summary.affected === 1
        ? "its remaining game is cancelled too"
        : `its ${summary.affected} remaining games are cancelled too`;
    case "kept":
      if (summary.affected === 0) return null;
      return summary.affected === 1 ? "1 game stays on the schedule" : `${summary.affected} games stay on the schedule`;
    case "deleted":
      return summary.games > 0 ? `removed with its ${plural(summary.games, "game", "games")}` : null;
  }
}

/** "Fri, Dec 11 – Sun, Dec 13 · 2 games — Del Mar Fields". */
export function tournamentPushBody(job: Pick<NotificationJob, "action" | "snapshot">, zone: string): string {
  const { snapshot } = job;
  const dates = tournamentDates(snapshot, zone);
  const games = snapshot.tournament ? gamesPhrase(snapshot.tournament) : null;
  // Where it is matters while it's on, not once it's off.
  const off = job.action === "cancelled" || job.action === "deleted";
  const where = !off && snapshot.location_name ? ` — ${snapshot.location_name}` : "";
  return `${dates}${games ? ` · ${games}` : ""}${where}`;
}

/** "Reminder: Surf Cup starts tomorrow", "Reminder: Surf Cup starts Fri, Dec 11". */
export function tournamentReminderSubject(title: string, relativeDay: string | null, dayLabel: string): string {
  return `Reminder: ${title} starts ${relativeDay ?? dayLabel}`;
}

/** "Part of Surf Cup · Semifinal" for a game in a tournament, else null. */
export function partOfLine(game: { tournament_title?: string | null; round?: string | null }): string | null {
  const title = game.tournament_title?.trim();
  if (!title) return null;
  const round = game.round?.trim();
  return round ? `Part of ${title} · ${round}` : `Part of ${title}`;
}

/**
 * What the reminder cron reads of each event in its window, a game's tournament
 * included. Here rather than in the route, so tests can run it against the
 * database: an embed PostgREST can't resolve fails the whole run.
 */
export const REMINDER_EVENT_COLUMNS = `*, teams(name, timezone, home_uniform, away_uniform, home_uniform_color, away_uniform_color, ${TEAM_BRAND_COLUMNS}), locations(name), tournament:tournament_id(title)`;

/** What a tournament's reminder lists of each of its games. */
export const REMINDER_TOURNAMENT_GAME_COLUMNS =
  "id, title, start_time, end_time, timezone, opponent, home_away, round, is_cancelled";
