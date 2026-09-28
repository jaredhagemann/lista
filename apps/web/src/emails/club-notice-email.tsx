import { EmailButton, EmailHeading, EmailLayout, EmailText, Rich, renderEmail, type RichText } from "@/emails/layout";
import { LISTA_BRAND, type EmailBrand } from "@/emails/brand";

/**
 * A short notice about a club: ownership offers and changes, and closure
 * (BUG-013). Paragraphs are text with bold spans, never HTML, so names from
 * users are escaped however they're written.
 */
export function ClubNoticeEmail({
  heading,
  paragraphs,
  cta,
  footer,
  brand = LISTA_BRAND,
}: {
  heading: string;
  paragraphs: RichText[];
  cta?: { label: string; url: string };
  footer: string;
  brand?: EmailBrand;
}) {
  return (
    <EmailLayout brand={brand} preview={heading} footer={footer}>
      <EmailHeading>{heading}</EmailHeading>
      {paragraphs.map((paragraph, i) => (
        <EmailText key={i}>
          <Rich text={paragraph} />
        </EmailText>
      ))}
      {cta && (
        <EmailButton href={cta.url} brand={brand}>
          {cta.label}
        </EmailButton>
      )}
    </EmailLayout>
  );
}

export function renderClubNoticeEmail(props: Parameters<typeof ClubNoticeEmail>[0]) {
  return renderEmail(<ClubNoticeEmail {...props} />);
}
