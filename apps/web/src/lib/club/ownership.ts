import type { adminClient } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/notifications/email";
import { renderClubNoticeEmail } from "@/emails/club-notice-email";
import { orgInviteBaseUrl, orgInviteBranding } from "@/lib/invitations/invite-base-url";
import {
  OWNERSHIP_NOTICE_FOOTER,
  ownershipChangedNotice,
  transferDeclinedNotice,
  transferOfferNotice,
  type ClubNotice,
} from "@/emails/club-notices";

/**
 * What happens around a change of club owner (BUG-013, part 2): the emails, and
 * Stripe. The change itself is the database's (respond_ownership_transfer,
 * recover_club_ownership); these steps follow it and never undo it.
 *
 * Decision (2026-09-24): billing carries on untouched. Stripe's billing email
 * moves to the new owner; the card on file stays until they replace it.
 */

type Admin = ReturnType<typeof adminClient>;

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

/** Sends a notice in the club's brand; reports whether it went, and never throws. */
async function notify(orgId: string, to: string | null, { subject, ...notice }: ClubNotice): Promise<boolean> {
  if (!to) return false;
  try {
    const brand = await orgInviteBranding(orgId);
    const email = await renderClubNoticeEmail({ ...notice, footer: OWNERSHIP_NOTICE_FOOTER, brand });
    await sendEmail({ to, subject, ...email, brandName: brand.fromName });
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
  await notify(orgId, to.email, transferOfferNotice({ clubName: club.name, fromName: from.name, url }));
}

/** Tells the owner their offer was declined. */
export async function sendTransferDeclined(admin: Admin, { orgId, fromId, toId }: { orgId: string; fromId: string; toId: string }) {
  const [club, from, to] = await Promise.all([clubOf(admin, orgId), personOf(admin, fromId), personOf(admin, toId)]);
  await notify(orgId, from.email, transferDeclinedNotice({ clubName: club.name, toName: to.name }));
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

  const noticeSent = await notify(
    orgId,
    previous.email,
    ownershipChangedNotice({ clubName: club.name, nextName: next.name, how })
  );

  return { billingEmailUpdated, noticeSent };
}
