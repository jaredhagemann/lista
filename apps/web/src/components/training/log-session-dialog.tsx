"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DURATION_QUICK_PICKS,
  MAX_NOTES_LENGTH,
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  TRAINING_CATEGORIES,
  TRAINING_CATEGORY_LABELS,
  BACKDATE_WINDOW_DAYS,
  todayInTz,
  toDateStr,
  type TrainingCategory,
} from "@/lib/training";
import type { TeamRef } from "./training-view";

export type EditableSession = {
  id: string;
  session_date: string;
  duration_minutes: number;
  category: TrainingCategory;
  notes: string | null;
  team_id: string;
};

export function LogSessionDialog({
  open,
  onOpenChange,
  profileId,
  eligibleTeams,
  defaultTeamId,
  timezone,
  session,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  eligibleTeams: TeamRef[];
  defaultTeamId: string;
  timezone: string | null;
  session?: EditableSession;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const today = todayInTz(timezone);
  const minDate = toDateStr(new Date(new Date(today + "T00:00:00Z").getTime() - BACKDATE_WINDOW_DAYS * 86400000));

  const [date, setDate] = useState(session?.session_date ?? today);
  const [minutes, setMinutes] = useState<number | "">(session?.duration_minutes ?? 30);
  const [category, setCategory] = useState<TrainingCategory>(session?.category ?? "ball_mastery");
  const [notes, setNotes] = useState(session?.notes ?? "");
  const [teamId, setTeamId] = useState(session?.team_id ?? defaultTeamId);
  const [saving, setSaving] = useState(false);

  const isEdit = !!session;

  async function handleSave() {
    if (minutes === "" || minutes < MIN_SESSION_MINUTES || minutes > MAX_SESSION_MINUTES) {
      toast.error(`Duration must be between ${MIN_SESSION_MINUTES} and ${MAX_SESSION_MINUTES} minutes.`);
      return;
    }
    setSaving(true);
    const payload = {
      profile_id: profileId,
      team_id: teamId,
      session_date: date,
      duration_minutes: minutes,
      category,
      notes: notes.trim() || null,
    };
    const res = isEdit
      ? await supabase.from("training_sessions").update(payload).eq("id", session!.id)
      : await supabase.from("training_sessions").insert(payload);
    setSaving(false);

    if (res.error) {
      toast.error(mapError(res.error.message));
      return;
    }
    toast.success(isEdit ? "Session updated" : "Session logged");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit session" : "Log a session"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {eligibleTeams.length > 1 && (
            <div className="space-y-1.5">
              <Label>Team</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {eligibleTeams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="session-date">Date</Label>
            <Input
              id="session-date"
              type="date"
              value={date}
              min={minDate}
              max={today}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="session-minutes">Duration (minutes)</Label>
            <div className="flex flex-wrap gap-2">
              {DURATION_QUICK_PICKS.map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={minutes === m ? "default" : "outline"}
                  onClick={() => setMinutes(m)}
                >
                  {m}
                </Button>
              ))}
              <Input
                id="session-minutes"
                type="number"
                className="w-24"
                min={MIN_SESSION_MINUTES}
                max={MAX_SESSION_MINUTES}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as TrainingCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRAINING_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {TRAINING_CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="session-notes">Notes (optional)</Label>
            <Textarea
              id="session-notes"
              value={notes}
              maxLength={MAX_NOTES_LENGTH}
              placeholder="What did you work on?"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Log session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Map the trigger's raise messages to something a player understands. */
function mapError(message: string): string {
  if (/daily training cap/i.test(message)) return "That would put you over the 360-minute daily limit.";
  if (/future/i.test(message)) return "You can't log a session in the future.";
  if (/7 days/i.test(message)) return "You can only log sessions from the last 7 days.";
  if (/archived/i.test(message)) return "That team is archived.";
  if (/player on this team/i.test(message)) return "You're not a player on that team.";
  return "Couldn't save the session. Please try again.";
}
