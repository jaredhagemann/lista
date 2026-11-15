import { eventTimeZone } from "@/lib/events/event-timezone";
import { gameTitle } from "@/lib/events/game-display";
import { isTournament, tournamentDates, tournamentLine } from "@/lib/events/tournament";
import {
  formatEventTimeRange,
  formatShortEventDate,
  localDate,
  resolveTimeZone,
} from "@/lib/notifications/event-time";
import { compareNames } from "@/lib/team-branding";

const DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AgendaEvent = {
  id: string;
  team_id: string | null;
  title: string;
  event_type: string;
  opponent: string | null;
  home_away: string | null;
  score_for: number | null;
  score_against: number | null;
  start_time: string;
  end_time: string;
  timezone: string | null;
  is_cancelled: boolean | null;
  round: string | null;
  tournament: { title: string } | null;
};

export type AgendaTeam = { id: string; name: string; timezone: string | null };

export type AgendaItem = {
  event: AgendaEvent;
  teamName: string;
  title: string;
  time: string;
  /** A game's tournament and round: "Surf Cup · Semifinal". */
  partOf: string | null;
};

export type AgendaDay = { key: string; heading: string; items: AgendaItem[] };

/**
 * The instants that could hold an event of the week, in any zone. Wider than the
 * week: buildAgenda decides which of these fall in it, by each event's own day.
 */
export function agendaQueryRange(now: Date): { endsAfter: string; startsBefore: string } {
  return {
    endsAfter: new Date(now.getTime() - 2 * DAY_MS).toISOString(),
    startsBefore: new Date(now.getTime() + (DAYS + 2) * DAY_MS).toISOString(),
  };
}

function addDays(day: string, count: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

/**
 * Every listed team's events for today and the next 6 days, by day, skipping days
 * without any. "Today" is the home zone's: the active team's, as the server can't
 * know the viewer's. An event sits on its day in its own zone, as the Schedule
 * page shows it. An event running over several days appears once: on its first
 * day, or today if that has passed.
 */
export function buildAgenda(
  events: AgendaEvent[],
  teams: AgendaTeam[],
  { now, homeZone }: { now: Date; homeZone: string | null | undefined },
): AgendaDay[] {
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const today = localDate(now, resolveTimeZone(homeZone));
  const lastDay = addDays(today, DAYS - 1);
  const byDay = new Map<string, AgendaItem[]>();

  for (const event of events) {
    const team = event.team_id ? teamsById.get(event.team_id) : undefined;
    if (!team) continue;

    const zone = eventTimeZone(event, team.timezone, "UTC");
    const first = localDate(new Date(event.start_time), zone);
    // The last minute: a tournament ends at the midnight starting the next day.
    const last = localDate(new Date(Date.parse(event.end_time) - 60_000), zone);
    if (first > lastDay || (last < today && first < today)) continue;

    const day = first < today ? today : first;
    const items = byDay.get(day) ?? [];
    items.push({
      event,
      teamName: team.name,
      title: gameTitle(event, team.name),
      time: isTournament(event)
        ? tournamentDates(event, zone)
        : formatEventTimeRange(event.start_time, event.end_time, zone),
      partOf: tournamentLine(event),
    });
    byDay.set(day, items);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => {
      // Noon UTC, formatted in UTC, is that calendar day in every case.
      const date = formatShortEventDate(`${key}T12:00:00Z`, "UTC");
      return {
        key,
        heading: key === today ? `Today · ${date}` : date,
        items: items.sort(compareItems),
      };
    });
}

function compareItems(a: AgendaItem, b: AgendaItem): number {
  return (
    // A tournament has no time of day, so it leads, as an all-day event does.
    Number(isTournament(b.event)) - Number(isTournament(a.event)) ||
    Date.parse(a.event.start_time) - Date.parse(b.event.start_time) ||
    compareNames(a.teamName, b.teamName) ||
    a.title.localeCompare(b.title)
  );
}
