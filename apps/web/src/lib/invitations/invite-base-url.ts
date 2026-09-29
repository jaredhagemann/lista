import { adminClient } from "@/lib/api-auth";
import { isClubPlan } from "@/lib/plan";
import { LISTA_BRAND, TEAM_BRAND_COLUMNS, clubEmailBrand, teamEmailBrand, type EmailBrand } from "@/emails/brand";

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
 * The email brand for a team's invitations: its club's, on a club plan, with
 * the team's own logo first; lista's otherwise (email-upgrade §4.2).
 */
export async function inviteBranding(teamId: string): Promise<EmailBrand> {
  const { data: team } = await adminClient().from("teams").select(TEAM_BRAND_COLUMNS).eq("id", teamId).single();
  return teamEmailBrand(team as Parameters<typeof teamEmailBrand>[0]);
}

/** The email brand for an organization's invitations (BUG-013 director invites): the club's, on a club plan. */
export async function orgInviteBranding(orgId: string | null): Promise<EmailBrand> {
  if (!orgId) return LISTA_BRAND;
  const { data: org } = await adminClient()
    .from("organizations")
    .select("name, org_name_public, logo_url, plan, brand_color_secondary")
    .eq("id", orgId)
    .single();
  return clubEmailBrand(org);
}

/**
 * The player's first name for a guardian invitation (one with a managed
 * profile), so its email can say "as Ava's guardian" rather than the "manager"
 * role guardian invitations are stored with (email-upgrade §4.4). Null for any
 * other invitation.
 */
export async function guardianOfName(managedProfileId: string | null | undefined): Promise<string | null> {
  if (!managedProfileId) return null;
  const { data } = await adminClient().from("profiles").select("first_name").eq("id", managedProfileId).maybeSingle();
  return data?.first_name?.trim() || null;
}
