import { adminClient } from "@/lib/api-auth";
import { isClubPlan } from "@/lib/plan";

/**
 * Resolves the correct base URL for invite links based on the team's org.
 *
 * Club-plan orgs with a subdomain get slug.lista.team (or custom_domain in Phase 2).
 * All other teams fall back to the default app URL.
 */
export async function inviteBaseUrl(teamId: string): Promise<string> {
  return orgInviteBaseUrl(await teamOrgId(teamId));
}

/** The invite base URL for an organization: its own domain on a club plan (BUG-013 director invites). */
export async function orgInviteBaseUrl(orgId: string | null): Promise<string> {
  if (orgId) {
    const { data: org } = await adminClient()
      .from("organizations")
      .select("plan, subdomain, custom_domain")
      .eq("id", orgId)
      .single();

    if (org && isClubPlan(org.plan)) {
      if (org.custom_domain) return `https://${org.custom_domain}`;
      if (org.subdomain) return `https://${org.subdomain}.lista.team`;
    }
  }

  return process.env.NEXT_PUBLIC_APP_URL ?? "https://lista.team";
}

async function teamOrgId(teamId: string): Promise<string | null> {
  const { data: team } = await adminClient()
    .from("teams")
    .select("organization_id")
    .eq("id", teamId)
    .single();
  return team?.organization_id ?? null;
}

/**
 * Resolves branding (brandName, logoUrl) for a team from its org record.
 * Returns nulls for free-plan or unaffiliated teams.
 */
export async function inviteBranding(
  teamId: string
): Promise<{ brandName: string | undefined; logoUrl: string | undefined }> {
  return orgInviteBranding(await teamOrgId(teamId));
}

/** Branding for an organization's invitations; nulls unless it is on a club plan. */
export async function orgInviteBranding(
  orgId: string | null
): Promise<{ brandName: string | undefined; logoUrl: string | undefined }> {
  if (orgId) {
    const { data: org } = await adminClient()
      .from("organizations")
      .select("plan, org_name_public, logo_url")
      .eq("id", orgId)
      .single();

    if (org && isClubPlan(org.plan)) {
      return {
        brandName: org.org_name_public ?? undefined,
        logoUrl: org.logo_url ?? undefined,
      };
    }
  }

  return { brandName: undefined, logoUrl: undefined };
}
