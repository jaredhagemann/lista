import type { adminClient } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe";
import { sendEmail, buildClubNoticeEmailHtml, escapeHtml } from "@/lib/notifications/email";
import { orgInviteBaseUrl } from "@/lib/invitations/invite-base-url";

/**
 * What happens around a change of club owner (BUG-013, part 2): the emails, and
 * Stripe. The change itself is the database's (respond_ownership_transfer,
 * recover_club_ownership); these steps follow it and never undo it.
 *
 * Decision (2026-09-24): billing carries on untouched. Stripe's billing email
 * moves to the new owner; the card on file stays until they replace it.
 */

type Admin = ReturnType<typeof adminClient>;

const FOOTER = "You received this email because you're an owner or director of a club on Lista.";

export async function personOf(admin: Admin, profileId: string | null) {
  if (!profileId) return { name: "Someone", email: null as string | null };
  const { data } = await admin
    .from("profiles")
    .select("first_name, last_name, email")
    .eq("id", profileId)
    .single();
  const name = [data?.first_name, data?.last_name].filter(Boolean).join(" ") || "Someone";
  return { name, email: data?.email ?? null };
}

async function clubOf(admin: Admin, orgId: string) {
  const { data } = await admin
    .from("organizations")
    .select("name, stripe_customer_id")
    .eq("id", orgId)
    .single();
  return { name: data?.name ?? "your club", stripeCustomerId: data?.stripe_customer_id ?? null };
}

async function portalUrl(orgId: string) {
  return `${await orgInviteBaseUrl(orgId)}/dashboard/club`;
}

/** Sends a notice; reports whether it went, and never throws. */
async function notify(to: string | null, subject: string, html: string): Promise<boolean> {
  if (!to) return false;
  try {
    await sendEmail({ to, subject, html });
    return true;
  } catch (err) {
    console.error("Failed to send club notice:", err);
    return false;
  }
}

/** Tells the director they have been offered the club. */
export async function sendTransferOffer(admin: Admin, { orgId, fromId, toId }: { orgId: string; fromId: string; toId: string }) {
  const [club, from, to, url] = await Promise.all([
    clubOf(admin, orgId),
    personOf(admin, fromId),
    personOf(admin, toId),
    portalUrl(orgId),
  ]);
  const clubName = escapeHtml(club.name);
  const fromName = escapeHtml(from.name);
  await notify(
    to.email,
    `${from.name} wants to hand ${club.name} over to you`,
    buildClubNoticeEmailHtml({
      heading: `You've been offered ownership of ${clubName}`,
      paragraphs: [
        `<strong>${fromName}</strong> would like you to become the owner of <strong>${clubName}</strong> on Lista.`,
        `As owner you'll be responsible for the club's billing and settings. ${fromName} will stay on as a director.`,
        `The offer expires in 14 days. You can accept or decline it from the club portal.`,
      ],
      cta: { label: "Review the offer", url },
      footer: FOOTER,
    })
  );
}

/** Tells the owner their offer was declined. */
export async function sendTransferDeclined(admin: Admin, { orgId, fromId, toId }: { orgId: string; fromId: string; toId: string }) {
  const [club, from, to] = await Promise.all([clubOf(admin, orgId), personOf(admin, fromId), personOf(admin, toId)]);
  await notify(
    from.email,
    `${to.name} declined ownership of ${club.name}`,
    buildClubNoticeEmailHtml({
      heading: `${escapeHtml(to.name)} declined ownership of ${escapeHtml(club.name)}`,
      paragraphs: [`You're still the owner. You can offer ownership to another director from the club settings.`],
      footer: FOOTER,
    })
  );
}

/**
 * After ownership has moved: Stripe's billing email goes to the new owner, and
 * the previous owner is told. `recovered` is support's path (the previous owner
 * did not take part), so their notice says how to object.
 */
export async function applyOwnershipChange(
  admin: Admin,
  {
    orgId,
    newOwnerId,
    previousOwnerId,
    how,
  }: { orgId: string; newOwnerId: string; previousOwnerId: string | null; how: "accepted" | "recovered" }
): Promise<{ billingEmailUpdated: boolean; noticeSent: boolean }> {
  const [club, next, previous] = await Promise.all([
    clubOf(admin, orgId),
    personOf(admin, newOwnerId),
    personOf(admin, previousOwnerId),
  ]);

  let billingEmailUpdated = false;
  if (club.stripeCustomerId && next.email) {
    try {
      await getStripe().customers.update(club.stripeCustomerId, { email: next.email });
      billingEmailUpdated = true;
    } catch (err) {
      console.error("Failed to move the club's billing email to the new owner:", err);
    }
  }

  const clubName = escapeHtml(club.name);
  const nextName = escapeHtml(next.name);
  const noticeSent = await notify(
    previous.email,
    how === "accepted" ? `${next.name} is now the owner of ${club.name}` : `Ownership of ${club.name} has moved to ${next.name}`,
    buildClubNoticeEmailHtml({
      heading: how === "accepted" ? `${nextName} is now the owner of ${clubName}` : `Ownership of ${clubName} has moved`,
      paragraphs:
        how === "accepted"
          ? [
              `${nextName} accepted your offer and is now the owner of <strong>${clubName}</strong>, including its billing.`,
              `You're now a director of the club.`,
            ]
          : [
              `Lista support has made <strong>${nextName}</strong> the owner of <strong>${clubName}</strong> at the request of the club, because its owner could no longer be reached.`,
              `You're now a director of the club. If you didn't expect this, reply to this email or contact support right away.`,
            ],
      footer: FOOTER,
    })
  );

  return { billingEmailUpdated, noticeSent };
}
