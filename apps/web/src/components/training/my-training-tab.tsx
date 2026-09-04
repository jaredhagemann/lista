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
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BACKDATE_WINDOW_DAYS,
  monthStartStr,
  todayInTz,
  MISSING_CATEGORY_LABEL,
  OLD_SESSION_LOCKED_LABEL,
  weekStartStr,
} from "@/lib/training";
import { LogSessionDialog, type EditableSession } from "./log-session-dialog";
import type { TrainingViewProps } from "./training-view";

/**
 * Per-row actions: edit/delete inside the 7-day window, or a disabled "Locked"
 * control that explains why once the session has aged out (spec §"My Training").
 * The reason is the control's accessible name (and its tooltip) so keyboard and
 * screen-reader users get it, not just sighted users on hover.
 */
export function SessionActions({
  editable,
  onEdit,
  onDelete,
}: {
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (editable) {
    return (
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon" aria-label="Edit" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Delete" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    );
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={OLD_SESSION_LOCKED_LABEL}
            className="flex shrink-0 cursor-not-allowed items-center gap-1 text-xs text-muted-foreground"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Locked
          </span>
        </TooltipTrigger>
        <TooltipContent>{OLD_SESSION_LOCKED_LABEL}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type SessionRow = {
  id: string;
  session_date: string;
  duration_minutes: number;
  category_id: string | null;
  notes: string | null;
  team_id: string;
  training_categories: { label: string } | null;
};

export function MyTrainingTab({ activeProfile, activeTeam, eligibleTeams }: TrainingViewProps) {
  const supabase = createClient();
  const today = todayInTz(activeTeam.timezone);
  const windowFloor = new Date(new Date(today + "T00:00:00Z").getTime() - BACKDATE_WINDOW_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);

  const PAGE_SIZE = 50;
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [wtd, setWtd] = useState(0);
  const [mtd, setMtd] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EditableSession | undefined>(undefined);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const canLog = eligibleTeams.length > 0;
  const defaultTeamId = eligibleTeams.find((t) => t.id === activeTeam.id)?.id ?? eligibleTeams[0]?.id ?? activeTeam.id;

  const load = useCallback(async () => {
    setLoading(true);
    const weekStart = weekStartStr(today);
    const monthStart = monthStartStr(today);

    // History is paginated (most-recent `visible`), with an exact count so we
    // know when to offer "Load more". WTD/MTD totals are aggregated in a
    // SEPARATE query so they're never truncated by the history page size.
    const historyReq = supabase
      .from("training_sessions")
      .select(
        "id, session_date, duration_minutes, category_id, notes, team_id, training_categories(label)",
        { count: "exact" }
      )
      .eq("profile_id", activeProfile.id)
      .order("session_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(0, visible - 1);

    // Month-to-date rows (only the two summed columns); bounds WTD too.
    const totalsReq = supabase
      .from("training_sessions")
      .select("session_date, duration_minutes")
      .eq("profile_id", activeProfile.id)
      .gte("session_date", monthStart);

    const [{ data: historyData, count }, { data: totalsData }] = await Promise.all([
      historyReq,
      totalsReq,
    ]);

    setSessions((historyData as SessionRow[]) ?? []);
    setTotal(count ?? 0);
    const monthRows = (totalsData as { session_date: string; duration_minutes: number }[]) ?? [];
    setMtd(monthRows.reduce((n, r) => n + r.duration_minutes, 0));
    setWtd(monthRows.filter((r) => r.session_date >= weekStart).reduce((n, r) => n + r.duration_minutes, 0));
    setLoading(false);
  }, [supabase, activeProfile.id, visible, today]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

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
                    {s.training_categories?.label ?? MISSING_CATEGORY_LABEL} · {s.duration_minutes} min
                  </div>
                  {s.notes && <div className="truncate text-xs text-muted-foreground">{s.notes}</div>}
                </div>
                <SessionActions
                  editable={editable}
                  onEdit={() => {
                    setEditing({ ...s, category_label: s.training_categories?.label ?? null });
                    setDialogOpen(true);
                  }}
                  onDelete={() => setDeleteId(s.id)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {!loading && sessions.length < total && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            Load more
          </Button>
        </div>
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
