"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useNavigate } from "@/components/layout/navigation-progress";
import { drainNotifications, withNotice } from "@/lib/notifications/client";
import type { TeamDisplay } from "@/lib/events/game-display";
import {
  gameTimesError,
  tournamentDays,
  tournamentErrorMessage,
  tournamentGameFields,
  type TournamentGameDraft,
} from "@/lib/events/tournament-form";
import { tournamentDates } from "@/lib/events/tournament";
import type { Database } from "@/types/database";
import { newGameDraft, TournamentGameRow } from "./tournament-game-rows";

type Event = Database["public"]["Tables"]["events"]["Row"];
type Game = Pick<Event, "id" | "start_time" | "is_cancelled">;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// ── Cancel (D15) ──────────────────────────────────────────────────────────────

/**
 * "Cancel it and its remaining games", or "cancel the tournament only", which
 * keeps them on the schedule as standalone games. Played games are never
 * touched. One call, one notice (cancel_tournament).
 */
export function CancelTournamentDialog({
  open,
  onOpenChange,
  tournament,
  games,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournament: Pick<Event, "id" | "title">;
  games: Game[];
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);

  // What cancel_tournament acts on: games yet to start, not already cancelled.
  const [now] = useState(() => Date.now());
  const remaining = games.filter((g) => Date.parse(g.start_time) > now && !g.is_cancelled).length;

  async function cancel(cancelGames: boolean) {
    setBusy(true);
    const { error } = await supabase.rpc("cancel_tournament", {
      p_tournament_id: tournament.id,
      p_cancel_games: cancelGames,
    });
    setBusy(false);
    if (error) {
      toast.error(tournamentErrorMessage(error));
      return;
    }
    onOpenChange(false);
    toast.success(withNotice("Tournament cancelled", await drainNotifications()));
    router.refresh();
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel {tournament.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            {remaining === 0 ? (
              <>It will be marked as cancelled, and stay on the schedule.</>
            ) : (
              <>
                It has {remaining} {plural(remaining, "game", "games")} still to play. Cancel{" "}
                {plural(remaining, "it", "them")} with the tournament, or cancel the tournament only and{" "}
                {plural(remaining, "it stays", "they stay")} on the schedule as standalone{" "}
                {plural(remaining, "game", "games")}. Played games keep their results either way.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
          {remaining === 0 ? (
            <Button onClick={() => cancel(true)} disabled={busy}>
              Cancel tournament
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => cancel(false)} disabled={busy}>
                Cancel the tournament only
              </Button>
              <Button onClick={() => cancel(true)} disabled={busy}>
                {remaining === 1 ? "Cancel it and its remaining game" : `Cancel it and its ${remaining} remaining games`}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Restore (D15) ─────────────────────────────────────────────────────────────

/** Restores the tournament only: games cancelled with it are restored one by one. */
export function RestoreTournamentDialog({
  open,
  onOpenChange,
  tournament,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournament: Pick<Event, "id" | "title">;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);

  async function restore() {
    setBusy(true);
    const { error } = await supabase.from("events").update({ is_cancelled: false }).eq("id", tournament.id);
    setBusy(false);
    if (error) {
      toast.error(tournamentErrorMessage(error));
      return;
    }
    onOpenChange(false);
    toast.success(withNotice("Tournament restored", await drainNotifications()));
    router.refresh();
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore {tournament.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            The tournament will no longer be marked as cancelled. Games cancelled with it stay cancelled; restore each
            one you&apos;re playing from its own page.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
          <Button onClick={restore} disabled={busy}>
            Restore
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Delete (D5) ───────────────────────────────────────────────────────────────

/** Deletes the tournament with its games and their answers, in one call with one notice. */
export function DeleteTournamentDialog({
  open,
  onOpenChange,
  tournament,
  gameCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournament: Pick<Event, "id" | "title">;
  gameCount: number;
}) {
  const router = useRouter();
  const { navigate } = useNavigate();
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const { error } = await supabase.rpc("delete_tournament", { p_tournament_id: tournament.id });
    if (error) {
      toast.error(tournamentErrorMessage(error));
      setBusy(false);
      return;
    }
    toast.success(withNotice("Tournament deleted", await drainNotifications()));
    navigate("/dashboard/schedule");
    router.refresh();
  }

  const label =
    gameCount === 0
      ? "Delete the tournament"
      : `Delete the tournament and its ${gameCount} ${plural(gameCount, "game", "games")}`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {tournament.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            {gameCount === 0
              ? "This deletes the tournament and everyone's answers. It can't be undone."
              : `This deletes the tournament and every game in it, played ones included, with their results and everyone's answers. It can't be undone. To call it off but keep its history, cancel it instead.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
          <Button variant="destructive" onClick={remove} disabled={busy}>
            {busy ? "Deleting..." : label}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Add a game ────────────────────────────────────────────────────────────────

/** A game added to the tournament: in its zone, linked to it, with its round. */
export function AddTournamentGameDialog({
  open,
  onOpenChange,
  tournament,
  zone,
  team,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournament: Event;
  /** The tournament's zone: its games' times are entered in it. */
  zone: string;
  team: TeamDisplay;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const { firstDay, lastDay } = tournamentDays(tournament, zone);
  const [draft, setDraft] = useState<TournamentGameDraft>(() => newGameDraft(undefined, firstDay));
  // D3: a new event notifies unless the coach says otherwise.
  const [notifyTeam, setNotifyTeam] = useState(true);
  const [busy, setBusy] = useState(false);
  const [timesError, setTimesError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Before anything is written (TL-012).
    const invalid = gameTimesError(draft);
    setTimesError(invalid);
    if (invalid) return;
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("You must be signed in.");
      setBusy(false);
      return;
    }

    // The id is generated here so the creation notice can name the game.
    const id = crypto.randomUUID();
    // A game shares its tournament's location until it's given its own.
    const fields = tournamentGameFields(draft, zone, team.name, tournament.location_id);
    const { error } = await supabase.from("events").insert({
      id,
      team_id: tournament.team_id,
      tournament_id: tournament.id,
      event_type: "game",
      ...fields,
      timezone: zone,
      created_by: user.id,
    });
    if (error) {
      toast.error(tournamentErrorMessage(error));
      setBusy(false);
      return;
    }

    let summary = null;
    // Only an upcoming game is news.
    if (notifyTeam && Date.parse(fields.end_time) > Date.now()) {
      const { error: queueError } = await supabase.rpc("enqueue_event_notification", {
        p_event_id: id,
        p_action: "created",
      });
      if (queueError) {
        toast.error(`Game saved, but the notification could not be queued: ${queueError.message}`);
      } else {
        summary = await drainNotifications();
      }
    }

    toast.success(withNotice("Game added", summary));
    setBusy(false);
    setDraft(newGameDraft(draft, firstDay));
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a game to {tournament.title}</DialogTitle>
          <DialogDescription>{tournamentDates(tournament, zone)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <TournamentGameRow
            index={0}
            draft={draft}
            onChange={(next) => {
              setDraft(next);
              setTimesError(null);
            }}
            error={timesError}
            zone={zone}
            firstDay={firstDay}
            lastDay={lastDay}
            team={team}
          />
          <div className="flex items-center justify-between">
            <div>
              <Label>Notify the team</Label>
              <p className="text-sm text-muted-foreground">Email and push the families about this game</p>
            </div>
            <Switch checked={notifyTeam} onCheckedChange={setNotifyTeam} aria-label="Notify the team" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Adding..." : "Add game"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
