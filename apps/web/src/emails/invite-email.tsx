import { EmailButton, EmailHeading, EmailLayout, EmailText, FallbackLink, StatusBadge, renderEmail } from "@/emails/layout";
import type { EmailBrand } from "@/emails/brand";
import { displayLabel } from "@/lib/labels";

/**
 * A team invitation; a guardian's, for a player on the team; or a director's,
 * to help run a club (BUG-013). Spec: docs/specs/email-upgrade.md §4.4.
 */
export function InviteEmail({
  teamName,
  inviterName,
  role,
  inviteUrl,
  brand,
  kind = "team",
  guardianOf,
}: {
  /** The team, or for a club invitation the club. */
  teamName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
  brand: EmailBrand;
  kind?: "team" | "club";
  /**
   * The player's first name, for a guardian invitation. Guardian invitations
   * are stored with the role "manager" (BUG-012), which isn't what they are.
   */
  guardianOf?: string | null;
}) {
  const club = kind === "club";
  const heading = club ? `Help run ${teamName} on ${brand.name}` : `Join ${teamName} on ${brand.name}`;
  const badge = guardianOf ? "Guardian" : displayLabel(role);
  const as = club ? " as a director" : guardianOf ? ` as ${guardianOf}'s guardian` : "";
  const features = club
    ? ["Create and manage the club's teams", "See every team's schedule", "Invite coaches and players"]
    : guardianOf
      ? [`See ${guardianOf}'s schedule`, `Answer availability for ${guardianOf}`, "Stay in touch with the team"]
      : ["See the team schedule", "Share your availability", "Stay in touch with your team"];

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
      <EmailHeading>{heading}</EmailHeading>
      <StatusBadge label={badge} tone="indigo" />
      <EmailText>
        <strong>{inviterName}</strong>
        {` has invited you to ${club ? "help run" : "join"} `}
        <strong>{teamName}</strong>
        {`${as}. Accept to:`}
      </EmailText>
      <EmailText>
        {features.map((feature, i) => (
          <span key={feature}>
            {i > 0 && <br />}
            {`•  ${feature}`}
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
