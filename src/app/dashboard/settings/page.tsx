import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { NotificationPrefsForm } from "@/components/settings/notification-prefs-form";
import { PushSubscriptionButton } from "@/components/notifications/push-subscription";
import { TeamSettingsForm } from "@/components/settings/team-settings-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Database } from "@/types/database";

type NotifPrefs = Database["public"]["Tables"]["notification_preferences"]["Row"];
type TeamMemberWithTeam = Database["public"]["Tables"]["team_members"]["Row"] & {
  teams: Database["public"]["Tables"]["teams"]["Row"];
};

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: rawNotifPrefs } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("profile_id", user.id)
    .single();

  const { data: rawMembership } = await supabase
    .from("team_members")
    .select("*, teams(*)")
    .eq("profile_id", user.id)
    .limit(1)
    .single();

  const notifPrefs = rawNotifPrefs as NotifPrefs | null;
  const membership = rawMembership as TeamMemberWithTeam | null;
  const isAdmin = membership?.role === "coach" || membership?.role === "manager";

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Tabs defaultValue="notifications">
        <TabsList>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          {membership && <TabsTrigger value="team">Team</TabsTrigger>}
        </TabsList>
        <TabsContent value="notifications" className="space-y-8">
          <NotificationPrefsForm profileId={user.id} prefs={notifPrefs} />
          <PushSubscriptionButton />
        </TabsContent>
        {membership && (
          <TabsContent value="team">
            <TeamSettingsForm team={membership.teams} isAdmin={isAdmin} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
