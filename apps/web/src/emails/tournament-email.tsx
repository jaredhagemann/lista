import type { ReactNode } from "react";
import { Section, Text } from "@react-email/components";
import {
  DetailTable,
  EmailButton,
  EmailHeading,
  EmailLayout,
  EmailText,
  StatusBadge,
  renderEmail,
  type BadgeTone,
} from "@/emails/layout";
import type { EmailBrand } from "@/emails/brand";
import { Answers, joinNames, truncate, type AnswerRow } from "@/emails/event-email";
import { gameTitle } from "@/lib/events/game-display";
import { tournamentDates } from "@/lib/events/tournament";
import { formatEventTime, formatShortEventDate, resolveTimeZone } from "@/lib/notifications/event-time";
import type { TournamentGameSnapshot, TournamentGamesSummary } from "@/lib/notifications/dispatch";

export type TournamentEmailAction = "created" | "updated" | "restored" | "cancelled" | "deleted" | "reminder";

const ACTIONS: Record<TournamentEmailAction, { label: string; tone: BadgeTone }> = {
  created: { label: "New Tournament", tone: "green" },
  updated: { label: "Tournament Updated", tone: "amber" },
  restored: { label: "Back On", tone: "green" },
  // A deleted tournament is the same news to families as a cancelled one.
  cancelled: { label: "Tournament Cancelled", tone: "red" },
  deleted: { label: "Tournament Cancelled", tone: "red" },
  reminder: { label: "Tournament Reminder", tone: "blue" },
};

/** Who's asked to answer: never for a tournament that's off (spec §4, Notifications). */
const ASKS_FOR_ANSWERS: TournamentEmailAction[] = ["created", "updated", "restored", "reminder"];

const NOTES_LIMIT = 280;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the email says about its games, above their list. */
function gamesIntro(action: TournamentGamesSummary["games_action"], listed: number, total: number): string | null {
  switch (action) {
    case "created":
      return listed > 0 ? "Schedule" : null;
    case "cancelled":
      if (listed === 0) return null;
      return listed === 1 ? "Its 1 remaining game is cancelled too:" : `Its ${listed} remaining games are cancelled too:`;
    case "kept":
      if (listed === 0) return null;
      return listed === 1
        ? "Its 1 remaining game stays on the schedule as a standalone game:"
        : `Its ${listed} remaining games stay on the schedule as standalone games:`;
    case "deleted":
      return total > 0
        ? `It's been removed from the schedule, with its ${count(total, "game", "games")}:`
        : "It's been removed from the schedule.";
  }
}

/** "Fri, Dec 11 · 9:00 AM · U10 Girls vs Rivals FC · Pool A", in the game's own zone. */
function gameLine(game: TournamentGameSnapshot, teamName: string, fallbackZone: string): string {
  const zone = resolveTimeZone(game.timezone ?? fallbackZone);
  const name = gameTitle({ title: game.title, event_type: "game", opponent: game.opponent, home_away: game.home_away }, teamName, {
    includeScore: false,
  });
  const round = game.round?.trim();
  const parts = [formatShortEventDate(game.start_time, zone), formatEventTime(game.start_time, zone), name];
  // A game named by its round ("Final") doesn't repeat it.
  if (round && round !== name) parts.push(round);
  return `${parts.join(" · ")}${game.is_cancelled ? " (cancelled)" : ""}`;
}

/**
 * A tournament's notice: one per tournament-wide action, and its reminder
 * (docs/specs/tournaments-and-leagues.md §4, "Notifications", D6). Dates, not
 * times, and the games the notice is about.
 */
export function TournamentEmail({
  brand,
  teamName,
  title,
  start_time,
  end_time,
  timeZone,
  location,
  notes,
  action,
  games,
  previous,
  url,
  answers,
}: {
  brand: EmailBrand;
  teamName: string;
  title: string;
  start_time: string;
  end_time: string;
  /** The tournament's zone: its days are whole days there (D13). */
  timeZone?: string | null;
  location: string | null;
  notes?: string | null;
  action: TournamentEmailAction;
  /** Its games, when the notice is about them; absent for an edit to the tournament alone. */
  games?: { total: number; action: TournamentGamesSummary["games_action"]; list: TournamentGameSnapshot[] };
  /** The tournament as it was, for an update. */
  previous?: { start_time: string; end_time: string; location: string | null; timeZone?: string | null } | null;
  /** The tournament's page, or the schedule once it's gone. */
  url: string;
  answers?: AnswerRow[];
}) {
  const zone = resolveTimeZone(timeZone);
  const { label, tone } = ACTIONS[action];
  const off = action === "cancelled" || action === "deleted";

  const dates = tournamentDates({ start_time, end_time }, zone);
  const before = previous
    ? {
        dates: tournamentDates({ start_time: previous.start_time, end_time: previous.end_time }, resolveTimeZone(previous.timeZone ?? zone)),
        location: previous.location ?? null,
      }
    : null;

  const value = (current: string | null, old: string | null | undefined): ReactNode => {
    const shown = current ?? "—";
    if (off) return <span style={{ textDecoration: "line-through", color: "#9ca3af" }}>{shown}</span>;
    if (before && old !== undefined && old !== current) {
      return (
        <>
          <strong>{shown}</strong>
          <br />
          <span style={{ color: "#9ca3af" }}>Was </span>
          <span style={{ textDecoration: "line-through", color: "#9ca3af" }}>{old ?? "—"}</span>
        </>
      );
    }
    return shown;
  };

  // How many games it has: the total, less any already cancelled, for a notice about them all.
  const playing = games
    ? games.action === "created"
      ? games.list.filter((g) => !g.is_cancelled).length || games.total
      : games.total
    : null;

  const rows: Array<[string, ReactNode]> = [["Team", teamName], ["Dates", value(dates, before?.dates)]];
  if (location || before?.location) rows.push(["Location", value(location, before?.location)]);
  if (playing != null && games?.action === "created" && playing > 0) rows.push(["Games", count(playing, "game", "games")]);
  if (notes?.trim() && !off) rows.push(["Notes", truncate(notes.trim(), NOTES_LIMIT)]);

  const intro = games ? gamesIntro(games.action, games.list.length, games.total) : null;
  const players = (answers ?? []).filter((a) => !a.isRecipient).map((a) => a.name);
  const showAnswers = ASKS_FOR_ANSWERS.includes(action) && (answers?.length ?? 0) > 0;

  return (
    <EmailLayout
      brand={brand}
      preview={`${label}: ${title}`}
      footer={
        <>
          {`You received this email because you're a member of ${teamName} on ${brand.name}.`}
          <br />
          You can manage your notification preferences in your account settings.
        </>
      }
    >
      <StatusBadge label={label} tone={tone} />
      <EmailHeading spaced={!showAnswers || players.length === 0}>{title}</EmailHeading>
      {showAnswers && players.length > 0 && <EmailText muted>{`For ${joinNames(players)}`}</EmailText>}
      <DetailTable rows={rows} />
      {intro && (
        <Section style={{ marginTop: "20px" }}>
          <Text style={{ margin: "0 0 6px", fontSize: "15px", fontWeight: 600, color: "#111827" }}>{intro}</Text>
          {games!.list.map((game) => (
            <Text key={game.id} style={{ margin: "0 0 4px", fontSize: "14px", lineHeight: 1.5, color: "#374151" }}>
              {gameLine(game, teamName, zone)}
            </Text>
          ))}
        </Section>
      )}
      {showAnswers && <Answers answers={answers!} />}
      <EmailButton href={url} brand={brand}>
        {action === "deleted" ? "View schedule" : "View tournament"}
      </EmailButton>
    </EmailLayout>
  );
}

export function renderTournamentEmail(props: Parameters<typeof TournamentEmail>[0]) {
  return renderEmail(<TournamentEmail {...props} />);
}
