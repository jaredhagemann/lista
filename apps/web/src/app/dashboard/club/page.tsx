import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, Calendar } from "lucide-react";

export const metadata = { title: "Club Overview" };

export default async function ClubOverviewPage() {
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

  // Fetch all active teams in the org
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("name");

  const teamIds = (teams ?? []).map((t) => t.id);

  // Fetch member count and upcoming events in parallel
  const now = new Date();
  const weekFromNow = new Date(now);
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const [{ count: memberCount }, { count: upcomingCount }] = await Promise.all([
    supabase
      .from("team_members")
      .select("profile_id", { count: "exact", head: true })
      .in("team_id", teamIds.length ? teamIds : [""]),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .in("team_id", teamIds.length ? teamIds : [""])
      .gte("start_time", now.toISOString())
      .lte("start_time", weekFromNow.toISOString()),
  ]);

  const stats = [
    {
      label: "Active Teams",
      value: teams?.length ?? 0,
      icon: Building2,
    },
    {
      label: "Total Members",
      value: memberCount ?? 0,
      icon: Users,
      note: "across all teams",
    },
    {
      label: "Events This Week",
      value: upcomingCount ?? 0,
      icon: Calendar,
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Club Overview</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {s.label}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{s.value}</p>
                {s.note && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.note}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {teams && teams.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Teams</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {teams.map((t) => (
              <Card key={t.id} className="p-4">
                <p className="font-medium">{t.name}</p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
