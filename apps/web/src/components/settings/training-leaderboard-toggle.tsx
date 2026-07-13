"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function TrainingLeaderboardToggle({
  profile,
}: {
  profile: { id: string; firstName: string | null; optedOut: boolean };
}) {
  // The column stores opt-OUT; the switch shows the positive "appear on boards".
  const [shown, setShown] = useState(!profile.optedOut);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  async function handleChange(next: boolean) {
    setShown(next);
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ training_leaderboard_opt_out: !next })
      .eq("id", profile.id);
    setSaving(false);
    if (error) {
      setShown(!next); // revert
      toast.error("Couldn't update that setting.");
      return;
    }
    toast.success(next ? "You'll appear on training leaderboards." : "You're hidden from training leaderboards.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Training leaderboards</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="training-leaderboard-toggle" className="font-normal">
            Show {profile.firstName ? `${profile.firstName} ` : "me "}on training leaderboards
          </Label>
          <Switch
            id="training-leaderboard-toggle"
            checked={shown}
            disabled={saving}
            onCheckedChange={handleChange}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Your coaches can always see your training log. This only controls whether you appear on
          leaderboards other players can see — including the club-wide board, where your first name,
          last initial, and profile photo are visible to other members of your club.
        </p>
      </CardContent>
    </Card>
  );
}
