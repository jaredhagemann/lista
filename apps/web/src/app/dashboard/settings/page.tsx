import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { NotificationPrefsForm } from "@/components/settings/notification-prefs-form";
import { PushSubscriptionButton } from "@/components/notifications/push-subscription";
import { TeamSettingsForm } from "@/components/settings/team-settings-form";
import { TransferOwnershipSection } from "@/components/settings/transfer-ownership-section";
import { DeleteTeamSection } from "@/components/settings/delete-team-section";
import { AccountSettings } from "@/components/settings/account-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getActiveMembership } from "@/lib/get-active-membership";
import type { Database } from "@/types/database";

type NotifPrefs = Database["public"]["Tables"]["notification_preferences"]["Row"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { tab } = await searchParams;
  const defaultTab = tab === "account" || tab === "team" ? tab : "notifications";

  const [{ data: rawNotifPrefs }, membership] = await Promise.all([
    supabase
      .from("notification_preferences")
      .select("*")
      .eq("profile_id", user.id)
      .single(),
    getActiveMembership(supabase, user.id),
  ]);

  const notifPrefs = rawNotifPrefs as NotifPrefs | null;
  const isAdmin =
    membership?.role === "coach" || membership?.role === "manager";
  const team = membership?.teams as Database["public"]["Tables"]["teams"]["Row"] | undefined;
  const isOwner = !!team && team.owner_id === user.id;

  // Fetch eligible admins for ownership transfer (auth-backed coaches/managers only)
  let eligibleAdmins: { profileId: string; name: string; role: string }[] = [];
  if (isOwner && team) {
    const admin = createAdminClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: adminMembers } = await admin
      .from("team_members")
      .select("profile_id, role, profiles(first_name, last_name, auth_user_id)")
      .eq("team_id", team.id)
      .in("role", ["coach", "manager"])
      .neq("profile_id", user.id);

    eligibleAdmins = (adminMembers ?? [])
      .filter((m) => {
        const p = m.profiles as { auth_user_id: string | null } | null;
        return p?.auth_user_id != null;
      })
      .map((m) => {
        const p = m.profiles as { first_name: string | null; last_name: string | null } | null;
        return {
          profileId: m.profile_id!,
          name: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Unknown",
          role: m.role,
        };
      });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          {membership && <TabsTrigger value="team">Team</TabsTrigger>}
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
        <TabsContent value="notifications" className="space-y-8">
          <NotificationPrefsForm profileId={user.id} prefs={notifPrefs} />
          <PushSubscriptionButton />
        </TabsContent>
        {membership && team && (
          <TabsContent value="team" className="space-y-6">
            <TeamSettingsForm team={team} isAdmin={isAdmin} />
            {isOwner && (
              <>
                <TransferOwnershipSection
                  teamId={team.id}
                  eligibleAdmins={eligibleAdmins}
                />
                <DeleteTeamSection teamId={team.id} teamName={team.name} />
              </>
            )}
          </TabsContent>
        )}
        <TabsContent value="account" className="space-y-6">
          <AccountSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
