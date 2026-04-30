import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ClubBrandingClient } from "@/components/club/club-branding-client";
import type { Database } from "@/types/database";

export const metadata = { title: "Club Branding" };

type Org = Database["public"]["Tables"]["organizations"]["Row"];

export default async function ClubBrandingPage() {
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
    <ClubBrandingClient
      org={{
        id: org.id,
        orgNamePublic: org.org_name_public,
        brandColor: org.brand_color,
        brandColorSecondary: org.brand_color_secondary,
        subdomain: org.subdomain,
        logoUrl: org.logo_url,
        faviconUrl: org.favicon_url,
      }}
    />
  );
}
