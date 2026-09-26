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
import { teamBranding, type OrgBranding } from "@/lib/team-branding";
import { displayLabel } from "@/lib/labels";
import { useNavigate } from "@/components/layout/navigation-progress";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"] & {
  teams: Database["public"]["Tables"]["teams"]["Row"] & { organizations?: OrgBranding | null };
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
  const { navigate, isPending } = useNavigate();
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
    const result = await setActiveTeam(teamId);
    if (result && "redirectUrl" in result && result.redirectUrl) {
      window.location.assign(result.redirectUrl);
    } else {
      navigate("/dashboard");
      setSwitching(false);
    }
  }

  const currentTeam = activeMembership?.teams;
  // Club teams inherit the club logo and carry the club name (spec: team-branding-and-labels).
  const current = currentTeam ? teamBranding(currentTeam) : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="flex h-auto items-center gap-2 px-2 py-1 text-sm"
            disabled={switching || isPending}
          >
            {current?.logoUrl && (
              <img
                src={current.logoUrl}
                alt={`${current.displayName} logo`}
                className="h-6 w-6 rounded object-contain"
              />
            )}
            <span className="text-muted-foreground">
              {current?.displayName ?? "Select team"}
              {activeMembership?.role && (
                <span className="ml-1">
                  ({displayLabel(activeMembership.role)})
                </span>
              )}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {uniqueTeams.map((m) => {
            const brand = teamBranding(m.teams);
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
                  {brand.logoUrl && (
                    <img
                      src={brand.logoUrl}
                      alt={`${brand.displayName} logo`}
                      className="h-6 w-6 rounded object-contain"
                    />
                  )}
                  <div>
                    <p className="text-sm font-medium">{brand.displayName}</p>
                    <p className="text-xs text-muted-foreground">
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
              navigate("/dashboard");
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
