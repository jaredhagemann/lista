import type { ReactNode } from "react";
import { DetailTable, EmailButton, EmailHeading, EmailLayout, StatusBadge, renderEmail, type BadgeTone } from "@/emails/layout";
import type { EmailBrand } from "@/emails/brand";
import { displayLabel } from "@/lib/labels";
import { formatEventDate, formatEventTime, formatEventTimeRange, resolveTimeZone } from "@/lib/notifications/event-time";

export type EventEmailAction = "created" | "updated" | "cancelled" | "reminder";

const ACTIONS: Record<EventEmailAction, { label: string; tone: BadgeTone }> = {
  created: { label: "New Event", tone: "green" },
  updated: { label: "Event Updated", tone: "amber" },
  cancelled: { label: "Event Cancelled", tone: "red" },
  reminder: { label: "Event Reminder", tone: "blue" },
};

/** A new, changed or cancelled event, or an upcoming event's reminder. */
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
}) {
  const zone = resolveTimeZone(timeZone);
  const { label, tone } = ACTIONS[action];
  const arriveBy =
    arrivalTime != null
      ? formatEventTime(new Date(new Date(startTime).getTime() - arrivalTime * 60 * 1000), zone)
      : null;

  const rows: Array<[string, ReactNode]> = [
    ["Team", teamName],
    ["Type", displayLabel(eventType)],
    ["Date", formatEventDate(startTime, zone)],
    ["Time", formatEventTimeRange(startTime, endTime, zone)],
  ];
  if (arriveBy) {
    rows.push([
      "Arrive by",
      <>
        {`${arriveBy} `}
        <span style={{ color: "#6b7280" }}>{`(${arrivalTime} min early)`}</span>
      </>,
    ]);
  }
  if (location) rows.push(["Location", location]);

  return (
    <EmailLayout
      brand={brand}
      preview={`${label}: ${eventTitle}`}
      footer={
        <>
          {`You received this email because you're a member of ${teamName} on ${brand.name}.`}
          <br />
          You can manage your notification preferences in your account settings.
        </>
      }
    >
      <StatusBadge label={label} tone={tone} />
      <EmailHeading>{eventTitle}</EmailHeading>
      <DetailTable rows={rows} />
      {eventUrl && (
        <EmailButton href={eventUrl} brand={brand}>
          View event
        </EmailButton>
      )}
    </EmailLayout>
  );
}

export function renderEventEmail(props: Parameters<typeof EventEmail>[0]) {
  return renderEmail(<EventEmail {...props} />);
}
