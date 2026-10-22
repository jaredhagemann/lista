"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type MutableTeam = {
  id: string;
  name: string;
  /** A coach or manager: muting hides what their team is sent. */
  isAdmin: boolean;
};

/**
 * One switch per team the person hears from (team-notification-controls §3.1,
 * §3.4). Off mutes the team's email and push together (D1); each switch saves
 * as it's flipped. The account switches above still come first: a team that
 * isn't muted gets nothing the account has turned off.
 */
export function TeamMutesSection({
  profileId,
  teams,
  mutedTeamIds,
  highlightTeamId,
}: {
  profileId: string;
  teams: MutableTeam[];
  mutedTeamIds: string[];
  /** The team an email's "Mute [Team]" link named. */
  highlightTeamId?: string;
}) {
  const [muted, setMuted] = useState(() => new Set(mutedTeamIds));
  const [saving, setSaving] = useState<string | null>(null);
  const highlighted = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: "center" });
  }, []);

  async function setTeamOn(teamId: string, on: boolean) {
    const next = (mute: boolean) =>
      setMuted((current) => {
        const copy = new Set(current);
        if (mute) copy.add(teamId);
        else copy.delete(teamId);
        return copy;
      });

    next(!on);
    setSaving(teamId);
    const { error } = on
      ? await supabase
          .from("team_notification_mutes")
          .delete()
          .eq("profile_id", profileId)
          .eq("team_id", teamId)
      : await supabase
          .from("team_notification_mutes")
          .upsert({ profile_id: profileId, team_id: teamId, email_muted: true, push_muted: true });
    setSaving(null);

    if (error) {
      next(on);
      toast.error(`Couldn't save: ${error.message}`);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Teams</CardTitle>
        <CardDescription>
          Turn a team off to stop its emails and push notifications, including its chat. Your other teams aren&apos;t
          affected.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {teams.length === 0 && <p className="text-sm text-muted-foreground">You&apos;re not on any teams yet.</p>}
        {teams.map((team) => {
          const isHighlighted = team.id === highlightTeamId;
          return (
            <div
              key={team.id}
              ref={isHighlighted ? highlighted : undefined}
              data-team-id={team.id}
              data-highlighted={isHighlighted ? "true" : undefined}
              className={cn(
                "flex items-center justify-between gap-4 rounded-md px-3 py-2",
                isHighlighted && "bg-muted ring-2 ring-primary"
              )}
            >
              <div>
                <Label htmlFor={`team-mute-${team.id}`}>{team.name}</Label>
                {team.isAdmin && (
                  <p className="text-sm text-muted-foreground">
                    Turned off, you won&apos;t see the reminders and notices your team gets.
                  </p>
                )}
              </div>
              <Switch
                id={`team-mute-${team.id}`}
                aria-label={`Notifications from ${team.name}`}
                checked={!muted.has(team.id)}
                disabled={saving === team.id}
                onCheckedChange={(on) => setTeamOn(team.id, on)}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
