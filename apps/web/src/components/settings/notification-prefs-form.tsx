"use client";

import { useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { browserPushSupported, registerBrowserPush } from "@/lib/notifications/browser-push";
import type { Database } from "@/types/database";

type NotifPrefs = Database["public"]["Tables"]["notification_preferences"]["Row"];
type Channel = "email" | "push";

/**
 * The Notifications card: the account's email and push switches, then
 * whatever follows them in the card (the team switches). Each switch saves as
 * it's flipped. Turning push on also registers this browser.
 */
export function NotificationPrefsForm({
  profileId,
  prefs,
  children,
}: {
  profileId: string;
  prefs: NotifPrefs | null;
  children?: ReactNode;
}) {
  const [enabled, setEnabled] = useState({
    email: prefs?.email_enabled ?? true,
    push: prefs?.push_enabled ?? true,
  });
  const [saving, setSaving] = useState<Channel | null>(null);
  const supabase = createClient();

  async function setChannel(channel: Channel, on: boolean) {
    const previous = enabled;
    const next = { ...enabled, [channel]: on };
    setEnabled(next);
    setSaving(channel);

    const { error } = await supabase
      .from("notification_preferences")
      .upsert(
        { profile_id: profileId, email_enabled: next.email, push_enabled: next.push },
        { onConflict: "profile_id" }
      );

    if (error) {
      setEnabled(previous);
      toast.error(`Couldn't save: ${error.message}`);
    } else if (channel === "push" && on && browserPushSupported()) {
      try {
        await registerBrowserPush(supabase, profileId);
      } catch (err) {
        console.error("Push registration failed:", err);
        toast.error("Push is on, but this browser didn't allow notifications.");
      }
    }
    setSaving(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Choose how you want to be notified about events and updates.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="notify-email">Email notifications</Label>
              <p className="text-sm text-muted-foreground">Receive event reminders and updates via email.</p>
            </div>
            <Switch
              id="notify-email"
              aria-label="Email notifications"
              checked={enabled.email}
              disabled={saving !== null}
              onCheckedChange={(on) => setChannel("email", on)}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="notify-push">Push notifications</Label>
              <p className="text-sm text-muted-foreground">Receive push notifications on your phone and in this browser.</p>
            </div>
            <Switch
              id="notify-push"
              aria-label="Push notifications"
              checked={enabled.push}
              disabled={saving !== null}
              onCheckedChange={(on) => setChannel("push", on)}
            />
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
