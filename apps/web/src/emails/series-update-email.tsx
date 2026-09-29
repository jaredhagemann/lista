import { ChangeTable, EmailButton, EmailHeading, EmailLayout, EmailText, StatusBadge, renderEmail } from "@/emails/layout";
import type { EmailBrand } from "@/emails/brand";

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
}: {
  eventTitle: string;
  teamName: string;
  occurrences: number;
  /** Empty for a notice queued before the previous version was recorded. */
  changes: FieldChange[];
  scheduleUrl?: string;
  brand: EmailBrand;
}) {
  return (
    <EmailLayout
      brand={brand}
      preview={`Schedule Updated: ${eventTitle}`}
      footer={
        <>
          {`You received this email because you're a member of ${teamName} on ${brand.name}.`}
          <br />
          You can manage your notification preferences in your account settings.
        </>
      }
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
