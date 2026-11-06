"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { displayLabel } from "@/lib/labels";

/** What removing a director will change for them, read when the page loaded. */
export type DirectorImpact = {
  /** Teams they're on as director, which they'll be taken off. */
  directorTeams: number;
  /** Teams they own, which pass to the owner. */
  ownedTeams: string[];
  /** Their other roles on the club's teams, which stay. */
  otherRoles: Array<{ team: string; role: string }>;
};

/** What the removal did, from the server (remove_org_director). */
type RemovalSummary = {
  teamsPassed: string[];
  directorPlacesRemoved: number;
  rolesKept: Array<{ team: string; role: string }>;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "12U Girls as a coach and 14U Boys as a parent". */
function rolesSentence(roles: DirectorImpact["otherRoles"]) {
  const parts = roles.map((r) => `${r.team} as a ${displayLabel(r.role).toLowerCase()}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
}

/**
 * Removing a club director (BUG-047): asks first, saying what changes for them,
 * and then shows what happened. Removing a director is a big change, and
 * re-inviting them is the only way back.
 */
export function RemoveDirectorDialog({
  orgId,
  clubName,
  director,
  onClose,
}: {
  orgId: string;
  clubName: string;
  /** The director to remove, or null when closed. */
  director: { profileId: string; name: string; firstName: string; impact?: DirectorImpact } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RemovalSummary | null>(null);

  function close() {
    if (removing) return;
    setError(null);
    setDone(null);
    onClose();
  }

  async function remove() {
    if (!director || removing) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch("/api/club/directors/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, profileId: director.profileId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Couldn't remove the director. Please try again.");
        return;
      }
      setDone(body.summary ?? { teamsPassed: [], directorPlacesRemoved: 0, rolesKept: [] });
      router.refresh();
    } catch {
      setError("Couldn't remove the director. Check your connection and try again.");
    } finally {
      setRemoving(false);
    }
  }

  const impact = director?.impact;
  const first = director?.firstName ?? "";

  return (
    <AlertDialog open={!!director} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        {director && done ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden />
                Director removed
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm">
                  <p className="text-foreground">
                    {director.name} is no longer a director of {clubName}.
                  </p>
                  {done.teamsPassed.length > 0 && (
                    <p>
                      <span className="font-medium text-foreground">Passed to you:</span>{" "}
                      {done.teamsPassed.join(", ")}
                    </p>
                  )}
                  {done.rolesKept.length > 0 && (
                    <p>
                      <span className="font-medium text-foreground">Still on:</span>{" "}
                      {done.rolesKept.map((r) => `${r.team} (${displayLabel(r.role)})`).join(", ")}
                    </p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button onClick={close}>Done</Button>
            </AlertDialogFooter>
          </>
        ) : (
          director && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {director.name} as a director?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3 text-sm">
                    <p>This is a big change. {first} will:</p>
                    <ul className="list-disc space-y-1 pl-5">
                      <li>lose access to the club portal</li>
                      {(impact?.directorTeams ?? 0) > 0 && (
                        <li>be taken off {plural(impact!.directorTeams, "team", "teams")} they&apos;re on as director</li>
                      )}
                      {(impact?.ownedTeams.length ?? 0) > 0 && (
                        <li>hand over the teams they own to you: {impact!.ownedTeams.join(", ")}</li>
                      )}
                    </ul>
                    {(impact?.otherRoles.length ?? 0) > 0 && (
                      <p>
                        {first} stays on {rolesSentence(impact!.otherRoles)}.
                      </p>
                    )}
                    <p>You can invite {first} again later.</p>
                    {error && (
                      <p role="alert" className="rounded-md bg-destructive/10 p-3 text-destructive">
                        {error}
                      </p>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
                {/* Not AlertDialogAction, which would close the dialog before the result is in. */}
                <Button variant="destructive" onClick={remove} disabled={removing}>
                  {removing ? "Removing…" : "Remove director"}
                </Button>
              </AlertDialogFooter>
            </>
          )
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
