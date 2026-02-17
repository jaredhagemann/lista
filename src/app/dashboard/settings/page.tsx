import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/settings/profile-form";
import { NotificationPrefsForm } from "@/components/settings/notification-prefs-form";
import { PushSubscriptionButton } from "@/components/notifications/push-subscription";
import type { Database } from "@/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type NotifPrefs = Database["public"]["Tables"]["notification_preferences"]["Row"];

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

  const profile = rawProfile as Profile | null;
  const notifPrefs = rawNotifPrefs as NotifPrefs | null;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <ProfileForm profile={profile} />
      <NotificationPrefsForm
        profileId={user.id}
        prefs={notifPrefs}
      />
      <PushSubscriptionButton />
    </div>
  );
}
