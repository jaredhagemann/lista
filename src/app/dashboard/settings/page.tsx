import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/settings/profile-form";
import { ContactsCard } from "@/components/settings/contacts-card";
import { NotificationPrefsForm } from "@/components/settings/notification-prefs-form";
import { PushSubscriptionButton } from "@/components/notifications/push-subscription";
import { TeamSettingsForm } from "@/components/settings/team-settings-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Database } from "@/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
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

  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

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

  const { data: rawContacts } = await supabase
    .from("contacts")
    .select("*")
    .eq("profile_id", user.id)
    .order("created_at");

  type Contact = Database["public"]["Tables"]["contacts"]["Row"];
  const profile = rawProfile as Profile | null;
  const notifPrefs = rawNotifPrefs as NotifPrefs | null;
  const contacts = (rawContacts ?? []) as Contact[];
  const membership = rawMembership as TeamMemberWithTeam | null;
  const isAdmin = membership?.role === "coach" || membership?.role === "manager";

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {membership && <TabsTrigger value="team">Team</TabsTrigger>}
        </TabsList>
        <TabsContent value="profile" className="space-y-8">
          <ProfileForm profile={profile} />
          <ContactsCard profileId={user.id} contacts={contacts} />
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
