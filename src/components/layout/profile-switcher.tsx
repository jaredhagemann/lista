"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Users } from "lucide-react";
import { setActiveProfile } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import Link from "next/link";
import type { Database } from "@/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type TeamMember = Database["public"]["Tables"]["team_members"]["Row"] & {
  teams: Database["public"]["Tables"]["teams"]["Row"];
};

function initials(profile: Profile) {
  return (
    [profile.first_name, profile.last_name]
      .filter(Boolean)
      .map((n) => n![0])
      .join("")
      .toUpperCase() || "?"
  );
}

function displayName(profile: Profile) {
  return [profile.first_name, profile.last_name].filter(Boolean).join(" ");
}

export function ProfileSwitcher({
  ownProfile,
  activeProfile,
  profilesOnActiveTeam,
  activeTeamId,
}: {
  ownProfile: Profile | null;
  activeProfile: Profile | null;
  /** All team_member rows on the active team (includes own + managed profiles). */
  profilesOnActiveTeam: TeamMember[];
  activeTeamId: string;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  const isViewingAsManaged =
    activeProfile && ownProfile && activeProfile.id !== ownProfile.id;

  async function handleSwitch(profileId: string) {
    if (profileId === activeProfile?.id) return;
    setSwitching(true);
    await setActiveProfile(profileId, activeTeamId);
    router.refresh();
    setSwitching(false);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={switching}
          className={`flex h-auto items-center gap-2 px-2 py-1 text-sm ${
            isViewingAsManaged
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground"
          }`}
        >
          <Avatar className="h-5 w-5">
            <AvatarFallback className="text-[10px]">
              {activeProfile ? initials(activeProfile) : "?"}
            </AvatarFallback>
          </Avatar>
          <span>
            {isViewingAsManaged
              ? `Viewing as: ${activeProfile?.first_name}`
              : displayName(activeProfile ?? ownProfile!)}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {profilesOnActiveTeam.map((membership) => {
          const isOwn = membership.profile_id === ownProfile?.id;
          const profile = isOwn
            ? ownProfile
            : // profile data is embedded in the membership via join in the layout
              (membership as TeamMember & { profiles?: Profile }).profiles ??
              null;
          const pid = membership.profile_id!;
          const isActive = pid === activeProfile?.id;

          return (
            <DropdownMenuItem
              key={pid}
              onClick={() => handleSwitch(pid)}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-xs">
                    {profile ? initials(profile) : "?"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">
                    {profile ? displayName(profile) : pid.slice(0, 8)}
                    {isOwn && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {membership.role}
                  </p>
                </div>
              </div>
              {isActive && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings/managed-players">
            <Users className="mr-2 h-4 w-4" />
            Manage players
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
