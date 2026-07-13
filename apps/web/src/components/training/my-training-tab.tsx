"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  BACKDATE_WINDOW_DAYS,
  monthStartStr,
  todayInTz,
  TRAINING_CATEGORY_LABELS,
  weekStartStr,
  type TrainingCategory,
} from "@/lib/training";
import { LogSessionDialog, type EditableSession } from "./log-session-dialog";
import type { TrainingViewProps } from "./training-view";

type SessionRow = {
  id: string;
  session_date: string;
  duration_minutes: number;
  category: TrainingCategory;
  notes: string | null;
  team_id: string;
};

export function MyTrainingTab({ activeProfile, activeTeam, eligibleTeams }: TrainingViewProps) {
  const supabase = createClient();
  const today = todayInTz(activeTeam.timezone);
  const windowFloor = new Date(new Date(today + "T00:00:00Z").getTime() - BACKDATE_WINDOW_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EditableSession | undefined>(undefined);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const canLog = eligibleTeams.length > 0;
  const defaultTeamId = eligibleTeams.find((t) => t.id === activeTeam.id)?.id ?? eligibleTeams[0]?.id ?? activeTeam.id;

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("training_sessions")
      .select("id, session_date, duration_minutes, category, notes, team_id")
      .eq("profile_id", activeProfile.id)
      .order("session_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    setSessions((data as SessionRow[]) ?? []);
    setLoading(false);
  }, [supabase, activeProfile.id]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  const weekStart = weekStartStr(today);
  const monthStart = monthStartStr(today);
  const wtd = sessions.filter((s) => s.session_date >= weekStart).reduce((n, s) => n + s.duration_minutes, 0);
  const mtd = sessions.filter((s) => s.session_date >= monthStart).reduce((n, s) => n + s.duration_minutes, 0);

  async function handleDelete() {
    if (!deleteId) return;
    const { error } = await supabase.from("training_sessions").delete().eq("id", deleteId);
    setDeleteId(null);
    if (error) {
      toast.error("Couldn't delete that session.");
      return;
    }
    toast.success("Session deleted");
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-6 text-sm">
          <div>
            <div className="text-2xl font-bold tabular-nums">{wtd}</div>
            <div className="text-muted-foreground">min this week</div>
          </div>
          <div>
            <div className="text-2xl font-bold tabular-nums">{mtd}</div>
            <div className="text-muted-foreground">min this month</div>
          </div>
        </div>
        {canLog && (
          <Button
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Log session
          </Button>
        )}
      </div>

      {!canLog && (
        <p className="text-sm text-muted-foreground">
          Only roster players can log training. Switch to a player profile to log sessions.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sessions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No sessions yet. {canLog && "Log your first one above."}
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-md border">
          {sessions.map((s) => {
            const editable = s.session_date >= windowFloor;
            return (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                <div className="w-24 shrink-0 text-sm tabular-nums text-muted-foreground">
                  {new Date(s.session_date + "T00:00:00Z").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    {TRAINING_CATEGORY_LABELS[s.category]} · {s.duration_minutes} min
                  </div>
                  {s.notes && <div className="truncate text-xs text-muted-foreground">{s.notes}</div>}
                </div>
                {editable ? (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit"
                      onClick={() => {
                        setEditing(s);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => setDeleteId(s.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">Locked</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dialogOpen && (
        <LogSessionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          profileId={activeProfile.id}
          eligibleTeams={eligibleTeams}
          defaultTeamId={defaultTeamId}
          timezone={activeTeam.timezone}
          session={editing}
          onSaved={load}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes it from your log and the leaderboards. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
