import type { ReactNode } from "react";
import { Link, Section, Text } from "@react-email/components";
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
import { displayLabel } from "@/lib/labels";
import { AVAILABILITY, type AvailabilityStatus } from "@/lib/availability/status";
import { gameTitle, homeAwayLabel, type Uniform } from "@/lib/events/game-display";
import { formatEventDate, formatEventTime, formatEventTimeRange, resolveTimeZone } from "@/lib/notifications/event-time";

export type EventEmailAction = "created" | "updated" | "restored" | "cancelled" | "reminder";

const ACTIONS: Record<EventEmailAction, { label: string; tone: BadgeTone }> = {
  created: { label: "New Event", tone: "green" },
  updated: { label: "Event Updated", tone: "amber" },
  restored: { label: "Back On", tone: "green" },
  cancelled: { label: "Event Cancelled", tone: "red" },
  reminder: { label: "Event Reminder", tone: "blue" },
};

export type { AvailabilityStatus };

/** The app's own words for an answer, in email-safe colors matching its green, amber and red. */
const ANSWERS: Record<AvailabilityStatus, { label: string; symbol: string; color: string; border: string; text: string }> = {
  available: { ...AVAILABILITY.available, color: "#16a34a", border: "#86efac", text: "#15803d" },
  maybe: { ...AVAILABILITY.maybe, color: "#f59e0b", border: "#fcd34d", text: "#b45309" },
  unavailable: { ...AVAILABILITY.unavailable, color: "#dc2626", border: "#fca5a5", text: "#b91c1c" },
};

/**
 * One person the recipient answers for (spec §4.7, D9–D10): themselves when
 * they're on the team, and each player they're a guardian of.
 */
export type AnswerRow = {
  profileId: string;
  /** First name; the recipient's own row reads "You". */
  name: string;
  isRecipient: boolean;
  status: AvailabilityStatus | null;
  /** The event page, recording that answer for this person (D7). */
  links: Record<AvailabilityStatus, string>;
};

/** The event as it was, for an update: what changed is struck through. */
export type PreviousEvent = {
  startTime: string;
  endTime: string;
  arrivalTime: number | null;
  location: string | null;
  /** The zone the event was in: previous times read as recipients were told them (PR #96 review). */
  timeZone?: string | null;
};

const NOTES_LIMIT = 280;

/** A new, changed, cancelled or restored event, or an upcoming event's reminder. */
export function EventEmail({
  eventTitle,
  eventType,
  startTime,
  endTime,
  location,
  teamName,
  action,
  arrivalTime,
  eventUrl,
  brand,
  timeZone,
  opponent,
  homeAway,
  uniform,
  notes,
  previous,
  answers,
  partOf,
  linkLabel = "View event",
}: {
  eventTitle: string;
  eventType: string;
  startTime: string;
  endTime: string;
  location: string | null;
  teamName: string;
  action: EventEmailAction;
  /** Minutes before the start. */
  arrivalTime?: number | null;
  eventUrl?: string;
  brand: EmailBrand;
  /** The event's zone: emails are built on a UTC server, so times are formatted in it (BUG-020, BUG-010). */
  timeZone?: string | null;
  opponent?: string | null;
  homeAway?: string | null;
  uniform?: Uniform | null;
  notes?: string | null;
  previous?: PreviousEvent | null;
  answers?: AnswerRow[];
  /** "Part of Surf Cup · Semifinal", for a game in a tournament. */
  partOf?: string | null;
  /** The button's words: "View schedule" when it links there (BUG-032). */
  linkLabel?: string;
}) {
  const zone = resolveTimeZone(timeZone);
  const { label, tone } = ACTIONS[action];
  const isGame = eventType === "game";
  const heading = gameTitle({ title: eventTitle, event_type: eventType, opponent, home_away: homeAway }, teamName, {
    includeScore: false,
  });
  const cancelled = action === "cancelled";

  const arriveBy = (start: string, minutes: number | null | undefined, inZone: string) =>
    minutes != null ? formatEventTime(new Date(new Date(start).getTime() - minutes * 60 * 1000), inZone) : null;

  // Each row's value now, and before the change when there was one.
  const now = {
    date: formatEventDate(startTime, zone),
    time: formatEventTimeRange(startTime, endTime, zone),
    arrive: arriveBy(startTime, arrivalTime, zone),
    location: location ?? null,
  };
  // In the zone it was in, so a move from Pacific to Mountain reads as it was told.
  const beforeZone = resolveTimeZone(previous?.timeZone ?? timeZone);
  const before = previous
    ? {
        date: formatEventDate(previous.startTime, beforeZone),
        time: formatEventTimeRange(previous.startTime, previous.endTime, beforeZone),
        arrive: arriveBy(previous.startTime, previous.arrivalTime, beforeZone),
        location: previous.location ?? null,
      }
    : null;

  const value = (current: string | null, old: string | null | undefined): ReactNode => {
    const shown = current ?? "—";
    if (cancelled) return <span style={{ textDecoration: "line-through", color: "#9ca3af" }}>{shown}</span>;
    if (before && old !== undefined && old !== current) {
      return (
        <>
          <strong>{shown}</strong>
          <br />
          {/* "Was" is words, not just a strikethrough, so plain text keeps the difference. */}
          <span style={{ color: "#9ca3af" }}>Was </span>
          <span style={{ textDecoration: "line-through", color: "#9ca3af" }}>{old ?? "—"}</span>
        </>
      );
    }
    return shown;
  };

  const rows: Array<[string, ReactNode]> = [];
  if (!isGame || !opponent) rows.push(["Team", teamName]);
  rows.push(["Date", value(now.date, before?.date)]);
  rows.push(["Time", value(now.time, before?.time)]);
  if (now.arrive || before?.arrive) rows.push(["Arrive by", value(now.arrive, before?.arrive)]);
  if (now.location || before?.location) rows.push(["Location", value(now.location, before?.location)]);
  if (isGame && homeAway) rows.push(["Home/Away", homeAwayLabel(homeAway)]);
  if (isGame && uniform) rows.push(["Uniform", <UniformValue key="uniform" uniform={uniform} />]);
  if (!isGame) rows.push(["Type", displayLabel(eventType)]);
  if (notes?.trim()) rows.push(["Notes", truncate(notes.trim(), NOTES_LIMIT)]);

  const players = (answers ?? []).filter((a) => !a.isRecipient).map((a) => a.name);
  const showAnswers = !cancelled && (answers?.length ?? 0) > 0;

  return (
    <EmailLayout
      brand={brand}
      preview={`${label}: ${heading}`}
      footer={
        <>
          {`You received this email because you're a member of ${teamName} on ${brand.name}.`}
          <br />
          You can manage your notification preferences in your account settings.
        </>
      }
    >
      <StatusBadge label={label} tone={tone} />
      <EmailHeading spaced={players.length === 0 && !partOf}>{heading}</EmailHeading>
      {partOf && <EmailText muted>{partOf}</EmailText>}
      {players.length > 0 && <EmailText muted>{`For ${joinNames(players)}`}</EmailText>}
      <DetailTable rows={rows} />
      {showAnswers && <Answers answers={answers!} />}
      {eventUrl && (
        <EmailButton href={eventUrl} brand={brand}>
          {linkLabel}
        </EmailButton>
      )}
    </EmailLayout>
  );
}

function UniformValue({ uniform }: { uniform: Uniform }) {
  return (
    <>
      {uniform.color && (
        <span
          style={{
            display: "inline-block",
            width: "12px",
            height: "12px",
            borderRadius: "3px",
            backgroundColor: uniform.color,
            border: "1px solid #d1d5db",
            marginRight: "6px",
            verticalAlign: "-1px",
          }}
        />
      )}
      {uniform.name}
    </>
  );
}

/** The availability section: a row per person, their answer, and the three links. */
export function Answers({ answers }: { answers: AnswerRow[] }) {
  // One title on every email, so it's plain what's being asked (2026-09-28).
  const prompt = "Availability";

  // Blocks, not a table: each person reads as its own paragraph in plain text,
  // and the links wrap under the name on a phone.
  return (
    <Section style={{ marginTop: "24px", backgroundColor: "#f9fafb", borderRadius: "10px", padding: "14px 16px" }}>
      <Text style={{ margin: "0 0 4px", fontSize: "15px", fontWeight: 600, color: "#111827" }}>{prompt}</Text>
      {answers.map((row) => (
        <Section key={row.profileId} style={{ padding: "8px 0 0" }}>
          <Text style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: "#111827" }}>
            <strong>{row.isRecipient ? "You" : row.name}</strong>
            <br />
            <CurrentAnswer status={row.status} />
          </Text>
          <Text style={{ margin: "4px 0 0" }}>
            {(Object.keys(ANSWERS) as AvailabilityStatus[]).map((status, i) => (
              <span key={status}>
                {i > 0 && <span style={{ color: "#f9fafb" }}> · </span>}
                <AnswerLink status={status} href={row.links[status]} chosen={row.status === status} />
              </span>
            ))}
          </Text>
        </Section>
      ))}
    </Section>
  );
}

function CurrentAnswer({ status }: { status: AvailabilityStatus | null }) {
  if (!status) return <span style={{ fontSize: "13px", color: "#6b7280" }}>No answer yet</span>;
  const { symbol, label, text } = ANSWERS[status];
  return <span style={{ fontSize: "13px", color: text, fontWeight: 600 }}>{`${symbol} ${label}`}</span>;
}

function AnswerLink({ status, href, chosen }: { status: AvailabilityStatus; href: string; chosen: boolean }) {
  const { symbol, label, color, border, text } = ANSWERS[status];
  return (
    <Link
      href={href}
      style={{
        display: "inline-block",
        margin: "2px 6px 2px 0",
        padding: "6px 10px",
        borderRadius: "6px",
        fontSize: "13px",
        fontWeight: 600,
        textDecoration: "none",
        border: `1px solid ${chosen ? color : border}`,
        ...(chosen ? { backgroundColor: color, color: "#ffffff" } : { color: text }),
      }}
    >
      {`${symbol} ${label}`}
    </Link>
  );
}

export function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** "Ava", "Ava and Zoey", "Ava, Zoey and Mia". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function renderEventEmail(props: Parameters<typeof EventEmail>[0]) {
  return renderEmail(<EventEmail {...props} />);
}
