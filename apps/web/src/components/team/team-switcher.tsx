"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, PlusCircle } from "lucide-react";
import { setActiveTeam } from "@/app/actions/team";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateTeamForm } from "@/components/team/create-team-form";
import type { Database } from "@/types/database";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"] & {
  teams: Database["public"]["Tables"]["teams"]["Row"];
};

export function TeamSwitcher({
  allMemberships,
  activeMembership,
}: {
  /** All team_member rows across own + managed profiles. */
  allMemberships: TeamMember[];
  activeMembership: TeamMember | null;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [ownedClubOrgs, setOwnedClubOrgs] = useState<{ id: string; name: string; orgNamePublic: string | null }[]>([]);

  useEffect(() => {
    if (!createOpen) return;
    fetch("/api/club/orgs")
      .then((r) => r.ok ? r.json() : [])
      .then(setOwnedClubOrgs)
      .catch(() => setOwnedClubOrgs([]));
  }, [createOpen]);

  // Deduplicate by team_id — each team appears once in the dropdown even if
  // both the parent and a managed profile are members.
  const uniqueTeams = Array.from(
    new Map(allMemberships.map((m) => [m.team_id, m])).values()
  );

  async function handleSwitch(teamId: string) {
    if (teamId === activeMembership?.team_id) return;
    setSwitching(true);
    await setActiveTeam(teamId);
    router.push("/dashboard");
    setSwitching(false);
  }

  const currentTeam = activeMembership?.teams;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="flex h-auto items-center gap-2 px-2 py-1 text-sm"
            disabled={switching}
          >
            {currentTeam?.logo_url && (
              <img
                src={currentTeam.logo_url}
                alt={`${currentTeam.name} logo`}
                className="h-5 w-5 rounded object-cover"
              />
            )}
            <span className="text-muted-foreground">
              {currentTeam?.name ?? "Select team"}
              {activeMembership?.role && (
                <span className="ml-1 capitalize">
                  ({activeMembership.role})
                </span>
              )}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {uniqueTeams.map((m) => {
            // Count how many of the user's profiles are on this team
            const profilesOnTeam = allMemberships.filter(
              (mb) => mb.team_id === m.team_id
            );
            const multiProfile = profilesOnTeam.length > 1;

            return (
              <DropdownMenuItem
                key={m.team_id}
                onClick={() => handleSwitch(m.team_id!)}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  {m.teams.logo_url && (
                    <img
                      src={m.teams.logo_url}
                      alt={`${m.teams.name} logo`}
                      className="h-4 w-4 rounded object-cover"
                    />
                  )}
                  <div>
                    <p className="text-sm font-medium">{m.teams.name}</p>
                    <p className="text-xs capitalize text-muted-foreground">
                      {multiProfile
                        ? `${profilesOnTeam.length} profiles`
                        : m.role}
                      {m.teams.season ? ` · ${m.teams.season}` : ""}
                    </p>
                  </div>
                </div>
                {m.team_id === activeMembership?.team_id && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Create new team
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a team</DialogTitle>
          </DialogHeader>
          <CreateTeamForm
            ownedClubOrgs={ownedClubOrgs}
            onSuccess={() => {
              setCreateOpen(false);
              router.push("/dashboard");
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
