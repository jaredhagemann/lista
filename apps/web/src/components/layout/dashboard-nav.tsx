"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Calendar, ClipboardList, Home, MessageSquare, Settings, Users, LogOut, Menu, X, Building2 } from "lucide-react";
import { useState } from "react";
import { TeamSwitcher } from "@/components/team/team-switcher";
import { ProfileSwitcher } from "@/components/layout/profile-switcher";
import type { Database } from "@/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type TeamMember = Database["public"]["Tables"]["team_members"]["Row"] & {
  teams: Database["public"]["Tables"]["teams"]["Row"];
};

const baseNavItems = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/dashboard/schedule", label: "Schedule", icon: Calendar },
  { href: "/dashboard/availability", label: "Availability", icon: ClipboardList },
  { href: "/dashboard/team", label: "Team", icon: Users },
  { href: "/dashboard/chat", label: "Chat", icon: MessageSquare },
];

export function DashboardNav({
  ownProfile,
  activeProfile,
  allMemberships,
  activeMembership,
  profilesOnActiveTeam,
  chatUnreadCount = 0,
  logoUrl = null,
  orgName,
  orgRole = null,
}: {
  ownProfile: Profile | null;
  activeProfile: Profile | null;
  allMemberships: TeamMember[];
  activeMembership: TeamMember | null;
  profilesOnActiveTeam: TeamMember[];
  chatUnreadCount?: number;
  /** Club logo URL — shows an <img> instead of the Lista wordmark when set. */
  logoUrl?: string | null;
  /** Club display name — used as alt text and wordmark fallback. */
  orgName?: string;
  /** Org role — when set, shows the Club admin nav link. */
  orgRole?: "owner" | "director" | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    ...baseNavItems,
    ...(orgRole ? [{ href: "/dashboard/club", label: "Club", icon: Building2 }] : []),
    { href: "/dashboard/settings", label: "Settings", icon: Settings },
  ];

  const profile = ownProfile;
  const initials =
    [profile?.first_name, profile?.last_name]
      .filter(Boolean)
      .map((n) => n![0])
      .join("")
      .toUpperCase() || "?";

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Show ProfileSwitcher only when the active team has >1 of the user's profiles
  const showProfileSwitcher =
    profilesOnActiveTeam.length > 1 && activeMembership?.team_id;

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={orgName ?? "Home"}
                width={180}
                height={56}
                className="h-14 w-auto object-contain"
              />
            ) : (
              <span className="text-xl font-bold">{orgName ?? "lista"}</span>
            )}
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);
              const badge = item.href === "/dashboard/chat" && chatUnreadCount > 0 ? chatUnreadCount : null;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  {badge && (
                    <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2">
            {showProfileSwitcher && (
              <ProfileSwitcher
                ownProfile={ownProfile}
                activeProfile={activeProfile}
                profilesOnActiveTeam={profilesOnActiveTeam}
                activeTeamId={activeMembership!.team_id!}
              />
            )}
            {allMemberships.length > 0 && (
              <TeamSwitcher
                allMemberships={allMemberships}
                activeMembership={activeMembership}
              />
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                <Avatar className="h-8 w-8">
                  {profile?.avatar_url && (
                    <AvatarImage src={profile.avatar_url} alt={initials} />
                  )}
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <div className="px-2 py-1.5">
                <Link
                  href="/dashboard/settings?tab=account"
                  className="text-sm font-medium hover:underline"
                >
                  {[profile?.first_name, profile?.last_name]
                    .filter(Boolean)
                    .join(" ")}
                </Link>
                <p className="text-xs text-muted-foreground">{profile?.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <nav className="border-t px-4 py-2 md:hidden">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
            const badge = item.href === "/dashboard/chat" && chatUnreadCount > 0 ? chatUnreadCount : null;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
                {badge && (
                  <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            );
          })}
          <div className="mt-2 flex flex-col gap-2 border-t pt-2">
            {showProfileSwitcher && (
              <ProfileSwitcher
                ownProfile={ownProfile}
                activeProfile={activeProfile}
                profilesOnActiveTeam={profilesOnActiveTeam}
                activeTeamId={activeMembership!.team_id!}
              />
            )}
            {allMemberships.length > 0 && (
              <TeamSwitcher
                allMemberships={allMemberships}
                activeMembership={activeMembership}
              />
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
