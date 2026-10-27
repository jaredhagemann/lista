import type { Database } from "@/types/database";

/**
 * Whether an event gets the daily reminder (team-notification-controls §4.1).
 * These rules decide whether a reminder goes out; who gets it is still each
 * member's own settings and team mutes.
 */

export type TeamReminderSettings = Pick<
  Database["public"]["Tables"]["team_reminder_settings"]["Row"],
  "enabled" | "remind_practice" | "remind_game" | "remind_other" | "remind_tournament"
>;

/** A team with no settings row: everything on. */
export const DEFAULT_REMINDER_SETTINGS: TeamReminderSettings = {
  enabled: true,
  remind_practice: true,
  remind_game: true,
  remind_other: true,
  remind_tournament: true,
};

/** An event's own choice: null follows the team. */
export type EventReminder = "always" | "never" | null;

const TYPE_SWITCH: Record<string, keyof Omit<TeamReminderSettings, "enabled">> = {
  practice: "remind_practice",
  // A game in a tournament follows the game rule too (D12).
  game: "remind_game",
  other: "remind_other",
  tournament: "remind_tournament",
};

/** What the team's settings mean for an event of this type, before its own choice. */
export function teamRemindsType(eventType: string, settings: TeamReminderSettings | null): boolean {
  const team = settings ?? DEFAULT_REMINDER_SETTINGS;
  const typeSwitch = TYPE_SWITCH[eventType];
  return team.enabled && (typeSwitch ? team[typeSwitch] : true);
}

export function shouldRemind(
  event: { event_type: string; is_cancelled: boolean | null; reminder?: string | null; tournament_id?: string | null },
  settings: TeamReminderSettings | null
): boolean {
  if (event.is_cancelled) return false;
  // The event's own choice wins, even over the team's switch (D9).
  if (event.reminder === "always") return true;
  if (event.reminder === "never") return false;
  return teamRemindsType(event.event_type, settings);
}
