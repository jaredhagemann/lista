import { EmailButton, EmailHeading, EmailLayout, EmailText, FallbackLink, renderEmail } from "@/emails/layout";
import type { EmailBrand } from "@/emails/brand";

/** Confirm the address a new account signed up with. */
export function ConfirmationEmail({
  confirmUrl,
  firstName,
  brand,
}: {
  confirmUrl: string;
  firstName?: string;
  brand: EmailBrand;
}) {
  return (
    <EmailLayout
      brand={brand}
      preview={`Confirm your ${brand.name} account`}
      footer={
        <>
          {`You received this email because you created an account on ${brand.name}.`}
          <br />
          If you didn&apos;t sign up, you can safely ignore this email.
        </>
      }
    >
      <EmailHeading>Confirm your account</EmailHeading>
      <EmailText>{firstName ? `Hi ${firstName},` : "Hi there,"}</EmailText>
      <EmailText>
        {`Thanks for signing up for ${brand.name}! Click the button below to confirm your email address and activate your account.`}
      </EmailText>
      <EmailButton href={confirmUrl} brand={brand}>
        Confirm my account
      </EmailButton>
      <FallbackLink href={confirmUrl} />
    </EmailLayout>
  );
}

export function renderConfirmationEmail(props: Parameters<typeof ConfirmationEmail>[0]) {
  return renderEmail(<ConfirmationEmail {...props} />);
}
