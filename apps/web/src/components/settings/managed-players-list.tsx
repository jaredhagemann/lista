"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { removeManagedProfile } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { Database } from "@/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export function ManagedPlayersList({
  managedProfiles,
}: {
  managedProfiles: { profile: Profile; relationship: string | null }[];
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);

  async function handleRemove(profileId: string, name: string) {
    const result = await removeManagedProfile(profileId);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(`${name} removed.`);
      router.refresh();
    }
    setRemoving(null);
  }

  const profileToRemove = removing
    ? managedProfiles.find((m) => m.profile.id === removing)
    : null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Your managed players</CardTitle>
          <CardDescription>
            Players you manage. You can set their availability and notification
            preferences by using the &ldquo;Viewing As&rdquo; switcher in the nav.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {managedProfiles.map(({ profile, relationship }) => {
            const name = [profile.first_name, profile.last_name]
              .filter(Boolean)
              .join(" ");
            const initials = [profile.first_name, profile.last_name]
              .filter(Boolean)
              .map((n) => n![0])
              .join("")
              .toUpperCase();

            return (
              <div
                key={profile.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    {profile.avatar_url && (
                      <img src={profile.avatar_url} alt={initials} />
                    )}
                    <AvatarFallback className="text-sm">{initials}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {relationship && (
                        <Badge variant="secondary" className="text-xs capitalize">
                          {relationship}
                        </Badge>
                      )}
                      {profile.birthday && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(profile.birthday).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setRemoving(profile.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove managed player?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll no longer manage{" "}
              {profileToRemove
                ? [
                    profileToRemove.profile.first_name,
                    profileToRemove.profile.last_name,
                  ]
                    .filter(Boolean)
                    .join(" ")
                : "this player"}
              . Their profile and team memberships are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (profileToRemove) {
                  const name = [
                    profileToRemove.profile.first_name,
                    profileToRemove.profile.last_name,
                  ]
                    .filter(Boolean)
                    .join(" ");
                  handleRemove(profileToRemove.profile.id, name);
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
