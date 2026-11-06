import { DetailTable, EmailButton, EmailHeading, EmailLayout, EmailText, FallbackLink, StatusBadge, renderEmail } from "@/emails/layout";
import type { EmailBrand } from "@/emails/brand";
import { displayLabel } from "@/lib/labels";

type InviteKind = "team" | "club";

/**
 * The invitee's name, for a team invitation. A guardian's or director's
 * invitation has none: it's for whoever owns the address.
 */
function addressedTo(kind: InviteKind, guardianOf: string | null | undefined, inviteeName: string | null | undefined) {
  if (kind === "club" || guardianOf) return null;
  return inviteeName?.trim() || null;
}

/**
 * The subject: the invitee's name when there is one, never the role
 * (docs/specs/invite-email-names.md).
 */
export function inviteSubject({
  teamName,
  kind = "team",
  guardianOf,
  inviteeName,
}: {
  teamName: string;
  kind?: InviteKind;
  guardianOf?: string | null;
  inviteeName?: string | null;
}) {
  const name = addressedTo(kind, guardianOf, inviteeName);
  return name ? `Invitation for ${name}: join ${teamName}` : `You're invited to join ${teamName}`;
}

/**
 * A team invitation; a guardian's, for a player on the team; or a director's,
 * to help run a club (BUG-013). Spec: docs/specs/email-upgrade.md §4.4, and
 * docs/specs/invite-email-names.md for the invitee's name and role.
 */
export function InviteEmail({
  teamName,
  inviterName,
  role,
  inviteUrl,
  brand,
  kind = "team",
  guardianOf,
  inviteeName,
}: {
  /** The team, or for a club invitation the club. */
  teamName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
  brand: EmailBrand;
  kind?: InviteKind;
  /**
   * The player's first name, for a guardian invitation. Guardian invitations
   * are stored with the role "manager" (BUG-012), which isn't what they are.
   */
  guardianOf?: string | null;
  /** The name on a team invitation. It may reach a parent, so it's named, not greeted. */
  inviteeName?: string | null;
}) {
  const club = kind === "club";
  const name = addressedTo(kind, guardianOf, inviteeName);
  const firstName = name?.split(/\s+/)[0];
  // A club invitation's "team" is the club, so not "Join SLOFC on SLOFC".
  const heading = club ? `Join ${teamName}` : `Join ${teamName} on ${brand.name}`;
  const badge = club ? "Director" : guardianOf ? "Guardian" : displayLabel(role);
  const as = club ? "as a director" : guardianOf ? `as ${guardianOf}'s guardian` : `as a ${badge.toLowerCase()}`;
  const verb = club ? "help run" : "join";
  const features = club
    ? ["Create and manage the club's teams", "See every team's schedule", "Invite coaches and players"]
    : guardianOf
      ? [`See ${guardianOf}'s schedule`, `Answer availability for ${guardianOf}`, "Stay in touch with the team"]
      : ["See the team schedule", "Share your availability", "Stay in touch with your team"];
  const details: Array<[string, string]> = [
    ...(name ? [["Invitation for", name] as [string, string]] : []),
    ...(guardianOf ? [["Player", guardianOf] as [string, string]] : []),
    ["Role", badge],
    [club ? "Club" : "Team", teamName],
    ["Invited by", inviterName],
  ];

  return (
    <EmailLayout
      brand={brand}
      preview={`${inviterName} has invited ${name ?? "you"} to ${verb} ${teamName} ${as}`}
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
        {" has invited "}
        {name ? <strong>{name}</strong> : "you"}
        {` to ${verb} `}
        <strong>{teamName}</strong>
        {` ${as}.`}
      </EmailText>
      <div style={{ margin: "0 0 20px" }}>
        <DetailTable rows={details} />
      </div>
      <EmailText>
        Accept to:
        {features.map((feature) => (
          <span key={feature}>
            <br />
            {`•  ${feature}`}
          </span>
        ))}
      </EmailText>
      <EmailButton href={inviteUrl} brand={brand}>
        Accept invitation
      </EmailButton>
      {/* The invite page asks "Are you Maya Lopez?" and lets a parent accept instead. */}
      {name && role === "player" && (
        <EmailText muted>
          {`Not ${firstName}? If you're ${firstName}'s parent or guardian, use the same button to accept for them.`}
        </EmailText>
      )}
      <FallbackLink href={inviteUrl} />
    </EmailLayout>
  );
}

export function renderInviteEmail(props: Parameters<typeof InviteEmail>[0]) {
  return renderEmail(<InviteEmail {...props} />);
}
