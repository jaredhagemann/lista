import { ChangeTable, EmailHeading, EmailLayout, EmailText, StatusBadge, renderEmail } from "@/emails/layout";
import type { EmailBrand } from "@/emails/brand";

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

/** One summary for a change to many occurrences of a series. */
export function SeriesUpdateEmail({
  eventTitle,
  teamName,
  changes,
  brand,
}: {
  eventTitle: string;
  teamName: string;
  changes: FieldChange[];
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
      {changes.length > 0 ? (
        <ChangeTable changes={changes} />
      ) : (
        <EmailText>The recurring schedule for this event has been updated.</EmailText>
      )}
    </EmailLayout>
  );
}

export function renderSeriesUpdateEmail(props: Parameters<typeof SeriesUpdateEmail>[0]) {
  return renderEmail(<SeriesUpdateEmail {...props} />);
}
