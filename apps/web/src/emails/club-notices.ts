import type { RichText } from "@/emails/layout";

/**
 * The wording of the club notices (BUG-013): ownership offers, declines and
 * changes, and closure. Kept apart from the senders so the previews
 * (src/emails/samples.tsx) show exactly what is sent.
 */

export type ClubNotice = {
  subject: string;
  heading: string;
  paragraphs: RichText[];
  cta?: { label: string; url: string };
};

export const OWNERSHIP_NOTICE_FOOTER = "You received this email because you're an owner or director of a club on Lista.";

/** To the director who has been offered the club. */
export function transferOfferNotice({ clubName, fromName, url }: { clubName: string; fromName: string; url: string }): ClubNotice {
  return {
    subject: `${fromName} wants to hand ${clubName} over to you`,
    heading: `You've been offered ownership of ${clubName}`,
    paragraphs: [
      [{ strong: fromName }, " would like you to become the owner of ", { strong: clubName }, " on Lista."],
      `As owner you'll be responsible for the club's billing and settings. ${fromName} will stay on as a director.`,
      `The offer expires in 14 days. You can accept or decline it from the club portal.`,
    ],
    cta: { label: "Review the offer", url },
  };
}

/** To the owner whose offer was declined. */
export function transferDeclinedNotice({ clubName, toName }: { clubName: string; toName: string }): ClubNotice {
  return {
    subject: `${toName} declined ownership of ${clubName}`,
    heading: `${toName} declined ownership of ${clubName}`,
    paragraphs: [`You're still the owner. You can offer ownership to another director from the club settings.`],
  };
}

/**
 * To the previous owner once ownership has moved. `recovered` is support's
 * path, when the owner couldn't be reached, so it says how to object.
 */
export function ownershipChangedNotice({
  clubName,
  nextName,
  how,
}: {
  clubName: string;
  nextName: string;
  how: "accepted" | "recovered";
}): ClubNotice {
  if (how === "accepted") {
    return {
      subject: `${nextName} is now the owner of ${clubName}`,
      heading: `${nextName} is now the owner of ${clubName}`,
      paragraphs: [
        [`${nextName} accepted your offer and is now the owner of `, { strong: clubName }, ", including its billing."],
        `You're now a director of the club.`,
      ],
    };
  }
  return {
    subject: `Ownership of ${clubName} has moved to ${nextName}`,
    heading: `Ownership of ${clubName} has moved`,
    paragraphs: [
      [
        "Lista support has made ",
        { strong: nextName },
        " the owner of ",
        { strong: clubName },
        " at the request of the club, because its owner could no longer be reached.",
      ],
      `You're now a director of the club. If you didn't expect this, reply to this email or contact support right away.`,
    ],
  };
}

/** To every member of a club that has closed. */
export function clubClosedNotice({ clubName, firstName }: { clubName: string; firstName: string | null }): ClubNotice & {
  footer: string;
} {
  return {
    subject: `${clubName} has closed`,
    heading: `${clubName} has closed`,
    paragraphs: [
      `Hi ${firstName || "there"},`,
      [
        { strong: clubName },
        " has been closed by its owner. Its teams, schedules and chat are still readable on Lista, but nothing new can be added.",
      ],
    ],
    footer: `You received this email because you were a member of ${clubName} on Lista.`,
  };
}
