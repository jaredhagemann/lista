import { saveContextCookie } from "@/lib/active-context-save";

/**
 * Lands this device where an accepted invitation leads (device-local-active-context,
 * D5): the child for a guardian or manager invitation, else the account's own
 * profile, on the invitation's team. A director invitation with no team saves
 * nothing.
 */
export async function saveInvitationLanding(
  userId: string,
  result: { teamId: string | null; managedProfileId: string | null }
) {
  if (!result.teamId) return;
  await saveContextCookie({
    accountId: userId,
    profileId: result.managedProfileId ?? userId,
    teamId: result.teamId,
  });
}
