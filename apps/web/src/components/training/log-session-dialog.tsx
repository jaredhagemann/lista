"use client";

import { useEffect, useState } from "react";
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
  BACKDATE_WINDOW_DAYS,
  todayInTz,
  toDateStr,
  sortCategories,
  type CategoryRow,
} from "@/lib/training";
import type { TeamRef } from "./training-view";

export type EditableSession = {
  id: string;
  session_date: string;
  duration_minutes: number;
  category_id: string | null;
  /** The current category's label, so an archived category can be retained in the picker. */
  category_label: string | null;
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
  const [teamId, setTeamId] = useState(session?.team_id ?? defaultTeamId);

  // Date bounds must use the SELECTED logging-context team's timezone, since the
  // DB validates the future/backdate window against safe_team_tz(new.team_id).
  // Falls back to the active team's tz (the prop) if the team isn't in the list.
  const selectedTz = eligibleTeams.find((t) => t.id === teamId)?.timezone ?? timezone;
  const today = todayInTz(selectedTz);
  const minDate = toDateStr(new Date(new Date(today + "T00:00:00Z").getTime() - BACKDATE_WINDOW_DAYS * 86400000));

  const [date, setDate] = useState(session?.session_date ?? today);
  const [minutes, setMinutes] = useState<number | "">(session?.duration_minutes ?? 30);
  const [notes, setNotes] = useState(session?.notes ?? "");
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [categoryId, setCategoryId] = useState<string>(session?.category_id ?? "");
  const [saving, setSaving] = useState(false);

  const isEdit = !!session;

  // If switching teams shifts "today" across a timezone/midnight boundary, clamp
  // the selected date into the new [minDate, today] window so the client can't
  // offer a date the DB would then reject (or vice-versa).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate((d) => (d > today ? today : d < minDate ? minDate : d));
  }, [today, minDate]);

  // Load the selected team's active categories; reload when the team changes so
  // the picker always reflects that team's managed list (categories are per-team).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("training_categories")
        .select("id, label, is_default, sort_order, is_active, created_at")
        .eq("team_id", teamId)
        .eq("is_active", true);
      if (cancelled) return;
      const rows = sortCategories((data as CategoryRow[]) ?? []);
      // When editing a session whose category was archived (so it's not in the
      // active list) — but only for its own team — retain it as an option so it
      // stays selected and a duration/note edit doesn't silently reassign it.
      const currentId = session?.category_id ?? null;
      if (
        isEdit &&
        currentId &&
        session?.team_id === teamId &&
        !rows.some((r) => r.id === currentId)
      ) {
        rows.push({
          id: currentId,
          label: `${session?.category_label ?? "Category"} (archived)`,
          is_default: false,
          sort_order: Number.MAX_SAFE_INTEGER,
          is_active: false,
          created_at: "",
        });
      }
      setCategories(rows);
      setCategoryId((prev) => {
        if (prev && rows.some((r) => r.id === prev)) return prev;
        return (rows.find((r) => r.is_default) ?? rows[0])?.id ?? "";
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, teamId, isEdit, session?.category_id, session?.category_label, session?.team_id]);

  async function handleSave() {
    if (minutes === "" || minutes < MIN_SESSION_MINUTES || minutes > MAX_SESSION_MINUTES) {
      toast.error(`Duration must be between ${MIN_SESSION_MINUTES} and ${MAX_SESSION_MINUTES} minutes.`);
      return;
    }
    if (!categoryId) {
      toast.error("Pick a category.");
      return;
    }
    setSaving(true);
    // On edit, only send category_id if the user actually changed it — so a
    // duration/note edit never rewrites the category, and a retained archived
    // category is left untouched (the trigger's rule 6 also skips unchanged links).
    const categoryChanged = !isEdit || categoryId !== (session?.category_id ?? null);
    const payload = {
      profile_id: profileId,
      team_id: teamId,
      session_date: date,
      duration_minutes: minutes,
      notes: notes.trim() || null,
      ...(categoryChanged ? { category_id: categoryId } : {}),
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
            <Select value={categoryId} onValueChange={setCategoryId} disabled={categories.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
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
