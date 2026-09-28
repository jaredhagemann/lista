import { EmailButton, EmailHeading, EmailLayout, EmailText, FallbackLink, StatusBadge, renderEmail } from "@/emails/layout";
import type { EmailBrand } from "@/emails/brand";
import { displayLabel } from "@/lib/labels";

/** A team invitation, or for a director (BUG-013) a club invitation. */
export function InviteEmail({
  teamName,
  inviterName,
  role,
  inviteUrl,
  brand,
  kind = "team",
}: {
  /** The team, or for a club invitation the club. */
  teamName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
  brand: EmailBrand;
  kind?: "team" | "club";
}) {
  const club = kind === "club";
  const features = club
    ? ["🗂️\u00a0 Create and manage the club's teams", "📅\u00a0 See every team's schedule", "👥\u00a0 Invite coaches and players"]
    : ["📅\u00a0 View the team schedule", "✅\u00a0 Share your availability", "💬\u00a0 Stay in touch with your team"];

  return (
    <EmailLayout
      brand={brand}
      preview={`${inviterName} has invited you to ${club ? "help run" : "join"} ${teamName}`}
      footer={
        <>
          {`You received this email because someone invited you to a ${club ? "club" : "team"} on ${brand.name}.`}
          <br />
          If you weren&apos;t expecting this, you can safely ignore it.
        </>
      }
    >
      <EmailHeading>{`You've been invited to join a ${club ? "club" : "team"} on ${brand.name}!`}</EmailHeading>
      <StatusBadge label={displayLabel(role)} tone="indigo" />
      <EmailText>
        <strong>{inviterName}</strong>
        {` has invited you to ${club ? "help run" : "join"} `}
        <strong>{teamName}</strong>
        {`${club ? " as a director" : ""}. Accept your invite and activate your account to do things like:`}
      </EmailText>
      <EmailText>
        {features.map((feature, i) => (
          <span key={feature}>
            {i > 0 && <br />}
            {feature}
          </span>
        ))}
      </EmailText>
      <EmailButton href={inviteUrl} brand={brand}>
        Accept invitation
      </EmailButton>
      <FallbackLink href={inviteUrl} />
    </EmailLayout>
  );
}

export function renderInviteEmail(props: Parameters<typeof InviteEmail>[0]) {
  return renderEmail(<InviteEmail {...props} />);
}
