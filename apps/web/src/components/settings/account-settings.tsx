"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { changePassword } from "@/app/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { TrainingLeaderboardToggle } from "@/components/settings/training-leaderboard-toggle";
import { useNavigate } from "@/components/layout/navigation-progress";
import { Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

function PasswordResetForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    !mismatch &&
    !isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setSuccess(false);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("currentPassword", currentPassword);
      formData.set("newPassword", newPassword);

      const result = await changePassword(null, formData);

      if (result.success) {
        setSuccess(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else if (result.error === "current_password_incorrect") {
        setError("Current password is incorrect.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change Password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isPending}
            />
            {mismatch && (
              <p className="text-sm text-destructive">Passwords do not match.</p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && (
            <p className="text-sm text-green-600">Password updated.</p>
          )}

          <Button type="submit" disabled={!canSubmit}>
            {isPending ? "Updating..." : "Update Password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

function DeleteAccountSection() {
  const { navigate, pendingHref } = useNavigate();
  const supabase = createClient();

  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [ownedTeams, setOwnedTeams] = useState<string[] | null>(null);
  // Open clubs this account owns: ownership must be handed over, or the club
  // closed, first (BUG-013).
  const [ownedClubs, setOwnedClubs] = useState<string[] | null>(null);
  // Players with no login of their own for whom this account is the only
  // guardian who can sign in. Deletion is refused until they have another.
  const [dependentPlayers, setDependentPlayers] = useState<string[] | null>(null);

  async function getToken(): Promise<string | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function showBlocker(res: Response) {
    const data = await res.json();
    if (data.error === "sole_guardian") {
      setDependentPlayers(data.players ?? []);
    } else if (data.error === "owns_club") {
      setOwnedClubs(data.clubs ?? []);
    } else {
      setOwnedTeams(data.teams ?? []);
    }
  }

  async function handleDeleteClick() {
    setInlineError(null);
    setOwnedTeams(null);
    setOwnedClubs(null);
    setDependentPlayers(null);
    setChecking(true);

    const token = await getToken();
    let res: Response;
    try {
      res = await fetch("/api/account/delete", {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      setChecking(false);
      setInlineError("Something went wrong. Please try again or contact support@lista.team.");
      return;
    }

    setChecking(false);

    if (res.status === 409) {
      await showBlocker(res);
      return;
    }

    if (res.ok) {
      setDialogOpen(true);
      return;
    }

    setInlineError("Something went wrong. Please try again or contact support@lista.team.");
  }

  async function handleConfirmDelete() {
    setDeleting(true);

    const token = await getToken();
    let res: Response;
    try {
      res = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      setDeleting(false);
      setDialogOpen(false);
      setInlineError("Something went wrong. Please try again or contact support@lista.team.");
      return;
    }

    if (res.ok) {
      // Best-effort local cleanup — the auth user no longer exists server-side
      try {
        await supabase.auth.signOut();
      } catch {
        // non-fatal
      }
      navigate("/login");
      return;
    }

    setDeleting(false);
    setDialogOpen(false);

    // Something changed between the eligibility check and confirmation.
    if (res.status === 409) {
      await showBlocker(res);
      return;
    }

    setInlineError("Something went wrong. Please try again or contact support@lista.team.");
  }

  return (
    <>
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Delete Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Permanently delete your account, profile, and team memberships. This
            cannot be undone. Note: managed player profiles you have created are
            retained as roster entries on their teams, and each must keep at
            least one guardian who can sign in.
          </p>

          {ownedClubs && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                You are the owner of <strong>{ownedClubs.join(", ")}</strong>. Hand the club over to one of its
                directors, or close it, before deleting your account.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={pendingHref !== null}
                onClick={() => navigate("/dashboard/club/settings")}
              >
                {pendingHref === "/dashboard/club/settings" && <Loader2 aria-hidden className="size-4 animate-spin" />}
                Go to Club Settings
              </Button>
            </div>
          )}

          {ownedTeams && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                You are the owner of the following team
                {ownedTeams.length !== 1 ? "s" : ""}:{" "}
                <strong>{ownedTeams.join(", ")}</strong>. Transfer or delete
                these teams before deleting your account.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={pendingHref !== null}
                onClick={() => navigate("/dashboard/settings?tab=team")}
              >
                {pendingHref === "/dashboard/settings?tab=team" && <Loader2 aria-hidden className="size-4 animate-spin" />}
                Go to Team Settings
              </Button>
            </div>
          )}

          {dependentPlayers && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                You are the only guardian who can sign in for{" "}
                <strong>{dependentPlayers.join(", ")}</strong>. Invite another
                guardian for {dependentPlayers.length !== 1 ? "each player" : "this player"}{" "}
                before deleting your account, so they keep someone who can
                manage their profile.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={pendingHref !== null}
                onClick={() => navigate("/dashboard/settings/managed-players")}
              >
                {pendingHref === "/dashboard/settings/managed-players" && <Loader2 aria-hidden className="size-4 animate-spin" />}
                Go to Managed Players
              </Button>
            </div>
          )}

          {inlineError && (
            <p className="text-sm text-destructive">{inlineError}</p>
          )}

          <Button
            variant="destructive"
            onClick={handleDeleteClick}
            disabled={checking || deleting}
          >
            {checking ? "Checking..." : "Delete Account"}
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!deleting) setDialogOpen(o);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              This will permanently delete your account, profile, and personal
              data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Exported composite component
// ---------------------------------------------------------------------------

export function AccountSettings({
  trainingProfile,
}: {
  trainingProfile?: { id: string; firstName: string | null; optedOut: boolean } | null;
}) {
  return (
    <div className="space-y-6">
      {trainingProfile && <TrainingLeaderboardToggle profile={trainingProfile} />}
      <PasswordResetForm />
      <Separator />
      <DeleteAccountSection />
    </div>
  );
}
