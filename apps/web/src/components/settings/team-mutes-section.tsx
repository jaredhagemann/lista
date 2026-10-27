"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type MutableTeam = {
  id: string;
  name: string;
};

/**
 * One switch per team the person hears from (team-notification-controls §3.1,
 * §3.4), as a section of the Notifications card. Off mutes the team's email
 * and push together (D1); each switch saves as it's flipped. The account
 * switches above still come first: a team that isn't muted gets nothing the
 * account has turned off.
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
  // Per team: one team finishing must not free another team still saving (review TM-001).
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const highlighted = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: "center" });
  }, []);

  async function setTeamOn(teamId: string, on: boolean) {
    const toggle = (set: ReadonlySet<string>, include: boolean) => {
      const copy = new Set(set);
      if (include) copy.add(teamId);
      else copy.delete(teamId);
      return copy;
    };
    const next = (mute: boolean) => setMuted((current) => toggle(current, mute));
    const markSaving = (pending: boolean) => setSaving((current) => toggle(current, pending));

    next(!on);
    markSaving(true);
    const { error } = on
      ? await supabase
          .from("team_notification_mutes")
          .delete()
          .eq("profile_id", profileId)
          .eq("team_id", teamId)
      : await supabase
          .from("team_notification_mutes")
          .upsert({ profile_id: profileId, team_id: teamId, email_muted: true, push_muted: true });
    markSaving(false);

    if (error) {
      next(on);
      toast.error(`Couldn't save: ${error.message}`);
    }
  }

  return (
    <section className="space-y-2 border-t pt-6">
      <div>
        <h3 className="text-sm font-semibold">Teams</h3>
        <p className="text-sm text-muted-foreground">
          Turn a team off to stop its emails and push notifications, including its chat. Your other teams aren&apos;t
          affected.
        </p>
      </div>
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
                "-mx-3 flex items-center justify-between gap-4 rounded-md px-3 py-2",
                isHighlighted && "bg-muted ring-2 ring-primary"
              )}
            >
              <Label htmlFor={`team-mute-${team.id}`}>{team.name}</Label>
              <Switch
                id={`team-mute-${team.id}`}
                aria-label={`Notifications from ${team.name}`}
                checked={!muted.has(team.id)}
                disabled={saving.has(team.id)}
                onCheckedChange={(on) => setTeamOn(team.id, on)}
              />
            </div>
          );
        })}
    </section>
  );
}
