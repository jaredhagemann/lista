import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ClubOrgProvider } from "@/context/club-org-context";
import { ClubSidebar } from "@/components/club/club-sidebar";
import { OwnershipOfferBanner } from "@/components/club/ownership-offer-banner";
import { hasClubAccess } from "@/lib/plan";
import type { Database } from "@/types/database";

type Org = Database["public"]["Tables"]["organizations"]["Row"];

export default async function ClubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Resolve active profile and its active team (mirrors dashboard layout logic)
  const cookieStore = await cookies();
  const activeProfileId =
    cookieStore.get("active_profile_id")?.value ?? user.id;

  const { data: activeProfile } = await supabase
    .from("profiles")
    .select("active_team_id")
    .eq("id", activeProfileId)
    .single();

  if (!activeProfile?.active_team_id) redirect("/dashboard");

  const { data: team } = await supabase
    .from("teams")
    .select("organization_id")
    .eq("id", activeProfile.active_team_id)
    .single();

  if (!team?.organization_id) redirect("/dashboard");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name, org_name_public, plan, subscription_status)")
    .eq("organization_id", team.organization_id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!membership) redirect("/dashboard");

  const org = membership.organizations as Org;

  // Compound access gate (spec → Feature Gating): the org must be on a club
  // tier AND have an access-granting subscription_status. Free orgs, stale
  // `trialing` writes on a free plan, and canceled club orgs are all sent to
  // the upgrade page. `past_due` keeps access so a failed payment can be fixed.
  if (!hasClubAccess(org.plan, org.subscription_status)) {
    redirect("/dashboard/settings?tab=plan");
  }

  // An offer of ownership addressed to this director (BUG-013).
  const { data: offer } = await supabase
    .from("organization_ownership_transfers")
    .select("id, expires_at, profiles!organization_ownership_transfers_from_profile_id_fkey(first_name, last_name)")
    .eq("organization_id", org.id)
    .eq("to_profile_id", user.id)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  const offeredBy = offer?.profiles as { first_name: string | null; last_name: string | null } | null;

  const clubOrg = {
    orgId: org.id,
    orgName: org.org_name_public ?? org.name,
    orgRole: membership.role as "owner" | "director",
    plan: org.plan,
    subscriptionStatus: org.subscription_status,
  };

  return (
    <ClubOrgProvider value={clubOrg}>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
        <ClubSidebar />
        <div className="flex-1 min-w-0 space-y-4">
          {offer && (
            <OwnershipOfferBanner
              transferId={offer.id}
              clubName={org.name}
              fromName={[offeredBy?.first_name, offeredBy?.last_name].filter(Boolean).join(" ") || "The owner"}
              expiresAt={offer.expires_at}
            />
          )}
          {children}
        </div>
      </div>
    </ClubOrgProvider>
  );
}
