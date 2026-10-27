import {
  ChangeTable,
  EmailButton,
  EmailHeading,
  EmailLayout,
  EmailText,
  StatusBadge,
  TeamNoticeFooter,
  renderEmail,
} from "@/emails/layout";
import type { EmailBrand } from "@/emails/brand";
import type { NotificationSettingsLinks } from "@/lib/notifications/settings-links";

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

/**
 * One summary for a change to many occurrences of a series: how many, and what
 * changed in recurring terms (day, time, arrival, location; seriesChanges).
 */
export function SeriesUpdateEmail({
  eventTitle,
  teamName,
  occurrences,
  changes,
  scheduleUrl,
  brand,
  settings,
}: {
  eventTitle: string;
  teamName: string;
  occurrences: number;
  /** Empty for a notice queued before the previous version was recorded. */
  changes: FieldChange[];
  scheduleUrl?: string;
  brand: EmailBrand;
  /** Footer links to mute this team or manage notifications (team-notification-controls §3.4). */
  settings?: NotificationSettingsLinks;
}) {
  return (
    <EmailLayout
      brand={brand}
      preview={`Schedule Updated: ${eventTitle}`}
      footer={<TeamNoticeFooter teamName={teamName} brandName={brand.name} settings={settings} />}
    >
      <StatusBadge label="Schedule Updated" tone="amber" />
      <EmailHeading spaced={false}>{eventTitle}</EmailHeading>
      <EmailText muted>{teamName}</EmailText>
      <EmailText>{`${occurrences} events in this series changed${changes.length > 0 ? ":" : "."}`}</EmailText>
      {changes.length > 0 && <ChangeTable changes={changes} />}
      {scheduleUrl && (
        <EmailButton href={scheduleUrl} brand={brand}>
          View schedule
        </EmailButton>
      )}
    </EmailLayout>
  );
}

export function renderSeriesUpdateEmail(props: Parameters<typeof SeriesUpdateEmail>[0]) {
  return renderEmail(<SeriesUpdateEmail {...props} />);
}
