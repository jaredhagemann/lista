import { adminClient } from "@/lib/api-auth";

/**
 * Resolves the correct base URL for invite links based on the team's org.
 *
 * Club-plan orgs with a subdomain get slug.lista.team (or custom_domain in Phase 2).
 * All other teams fall back to the default app URL.
 */
export async function inviteBaseUrl(teamId: string): Promise<string> {
  const admin = adminClient();

  const { data: team } = await admin
    .from("teams")
    .select("organization_id")
    .eq("id", teamId)
    .single();

  if (team?.organization_id) {
    const { data: org } = await admin
      .from("organizations")
      .select("plan, subdomain, custom_domain")
      .eq("id", team.organization_id)
      .single();

    if (org?.plan === "club") {
      if (org.custom_domain) return `https://${org.custom_domain}`;
      if (org.subdomain) return `https://${org.subdomain}.lista.team`;
    }
  }

  return process.env.NEXT_PUBLIC_APP_URL ?? "https://lista.team";
}

/**
 * Resolves branding (brandName, logoUrl) for a team from its org record.
 * Returns nulls for free-plan or unaffiliated teams.
 */
export async function inviteBranding(
  teamId: string
): Promise<{ brandName: string | undefined; logoUrl: string | undefined }> {
  const admin = adminClient();

  const { data: team } = await admin
    .from("teams")
    .select("organization_id")
    .eq("id", teamId)
    .single();

  if (team?.organization_id) {
    const { data: org } = await admin
      .from("organizations")
      .select("plan, org_name_public, logo_url")
      .eq("id", team.organization_id)
      .single();

    if (org?.plan === "club") {
      return {
        brandName: org.org_name_public ?? undefined,
        logoUrl: org.logo_url ?? undefined,
      };
    }
  }

  return { brandName: undefined, logoUrl: undefined };
}
