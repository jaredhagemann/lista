import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { Toaster } from "@/components/ui/sonner";
import type { Database } from "@/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type TeamMember = Database["public"]["Tables"]["team_members"]["Row"] & {
  teams: Database["public"]["Tables"]["teams"]["Row"];
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get user's profile and team memberships
  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: rawMemberships } = await supabase
    .from("team_members")
    .select("*, teams(*)")
    .eq("profile_id", user.id);

  const profile = rawProfile as Profile | null;
  const memberships = (rawMemberships ?? []) as TeamMember[];

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav
        profile={profile}
        memberships={memberships}
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <Toaster />
    </div>
  );
}
