import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ClubBillingClient } from "@/components/club/club-billing-client";
import type { Database } from "@/types/database";

export const metadata = { title: "Club Billing" };

type Org = Database["public"]["Tables"]["organizations"]["Row"];

export default async function ClubBillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const activeProfileId =
    cookieStore.get("active_profile_id")?.value ?? user.id;

  const { data: activeProfile } = await supabase
    .from("profiles")
    .select("active_team_id")
    .eq("id", activeProfileId)
    .single();

  const { data: team } = await supabase
    .from("teams")
    .select("organization_id")
    .eq("id", activeProfile?.active_team_id ?? "")
    .single();

  const orgId = team?.organization_id;
  if (!orgId) redirect("/dashboard");

  // Owner-only — directors are redirected to the club overview
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role, organizations(*)")
    .eq("organization_id", orgId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!membership) redirect("/dashboard");
  if (membership.role !== "owner") redirect("/dashboard/club");

  const org = membership.organizations as Org;

  return (
    <ClubBillingClient
      org={{
        id: org.id,
        plan: org.plan,
        subscriptionStatus: org.subscription_status,
        stripeSubscriptionId: org.stripe_subscription_id,
      }}
    />
  );
}
