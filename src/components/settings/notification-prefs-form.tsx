"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import type { Database } from "@/types/database";

type NotifPrefs = Database["public"]["Tables"]["notification_preferences"]["Row"];

export function NotificationPrefsForm({
  profileId,
  prefs,
}: {
  profileId: string;
  prefs: NotifPrefs | null;
}) {
  const [emailEnabled, setEmailEnabled] = useState(prefs?.email_enabled ?? true);
  const [pushEnabled, setPushEnabled] = useState(prefs?.push_enabled ?? true);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  async function handleSave() {
    setLoading(true);

    const { error } = await supabase
      .from("notification_preferences")
      .upsert(
        {
          profile_id: profileId,
          email_enabled: emailEnabled,
          push_enabled: pushEnabled,
        },
        { onConflict: "profile_id" }
      );

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Notification preferences saved");
    }

    setLoading(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Choose how you want to be notified about events and updates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Email notifications</Label>
            <p className="text-sm text-muted-foreground">
              Receive event reminders and updates via email.
            </p>
          </div>
          <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label>Push notifications</Label>
            <p className="text-sm text-muted-foreground">
              Receive push notifications in your browser.
            </p>
          </div>
          <Switch checked={pushEnabled} onCheckedChange={setPushEnabled} />
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSave} disabled={loading}>
          {loading ? "Saving..." : "Save preferences"}
        </Button>
      </CardFooter>
    </Card>
  );
}
