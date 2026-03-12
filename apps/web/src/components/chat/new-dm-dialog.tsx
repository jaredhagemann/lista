"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/types/database";
import type { DmChannelWithProfile } from "./channel-list";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type MemberManager = {
  profileId: string;
  firstName: string;
  lastName: string;
  relationship: string | null;
};
type TeamMemberWithProfile = Database["public"]["Tables"]["team_members"]["Row"] & {
  profiles: Profile | null;
  managers: MemberManager[];
};

export function NewDmDialog({
  open,
  onOpenChange,
  teamMembers,
  teamId,
  currentUserId,
  onDmCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamMembers: TeamMemberWithProfile[];
  teamId: string;
  currentUserId: string;
  onDmCreated: (dm: DmChannelWithProfile) => void;
}) {
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const supabase = createClient();

  const others = teamMembers.filter(
    (m) => m.profile_id !== currentUserId && m.profiles
  );

  const filtered = search.trim()
    ? others.filter((m) => {
        const name = [m.profiles!.first_name, m.profiles!.last_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return name.includes(search.toLowerCase());
      })
    : others;

  async function startDm(profileId: string) {
    setLoading(profileId);
    const [profileA, profileB] = [currentUserId, profileId].sort();

    const { error } = await supabase.from("dm_channels").insert({
      team_id: teamId,
      profile_a: profileA,
      profile_b: profileB,
    });

    if (error && !error.message.includes("duplicate")) {
      toast.error("Failed to start conversation");
      setLoading(null);
      return;
    }

    const { data: dm } = await supabase
      .from("dm_channels")
      .select("*")
      .eq("team_id", teamId)
      .eq("profile_a", profileA)
      .eq("profile_b", profileB)
      .single();

    setLoading(null);
    if (!dm) return;

    // Fetch the other person's profile for the channel list
    const { data: otherProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", profileId)
      .single();

    if (otherProfile) {
      onDmCreated({ ...dm, otherProfile: otherProfile as Profile, unreadCount: 0 });
      onOpenChange(false);
      setSearch("");
      setExpandedId(null);
    }
  }

  function handleRowClick(m: TeamMemberWithProfile) {
    if (m.managers.length === 0) {
      // Has own account — DM directly
      startDm(m.profile_id!);
    } else if (m.managers.length === 1) {
      // Single manager — auto-resolve
      startDm(m.managers[0].profileId);
    } else {
      // Multiple managers — expand sub-picker
      setExpandedId((prev) => (prev === m.profile_id ? null : m.profile_id!));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); setExpandedId(null); setSearch(""); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New Message</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Search teammates…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="max-h-72 overflow-y-auto space-y-1">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No teammates found</p>
          )}
          {filtered.map((m) => {
            const p = m.profiles!;
            const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
            const initials = [p.first_name, p.last_name]
              .filter(Boolean)
              .map((n) => n[0])
              .join("")
              .toUpperCase();
            const isManaged = m.managers.length > 0;
            const isExpanded = expandedId === m.profile_id;

            return (
              <div key={m.profile_id}>
                <button
                  onClick={() => handleRowClick(m)}
                  disabled={loading !== null}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    {p.avatar_url && <AvatarImage src={p.avatar_url} alt={name} />}
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{m.role}</p>
                  </div>
                  {isManaged && m.managers.length > 1 && (
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  )}
                  {isManaged && m.managers.length === 1 && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      via {m.managers[0].firstName}
                    </span>
                  )}
                </button>

                {/* Sub-picker for multiple managers */}
                {isExpanded && (
                  <div className="ml-11 mt-1 mb-1 space-y-1 border-l-2 border-muted pl-3">
                    <p className="text-xs text-muted-foreground py-1">Contact {p.first_name} via:</p>
                    {m.managers.map((mgr) => {
                      const mgrName = [mgr.firstName, mgr.lastName].filter(Boolean).join(" ");
                      const mgrInitials = ((mgr.firstName?.[0] ?? "") + (mgr.lastName?.[0] ?? "")).toUpperCase();
                      return (
                        <button
                          key={mgr.profileId}
                          onClick={() => startDm(mgr.profileId)}
                          disabled={loading === mgr.profileId}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent transition-colors"
                        >
                          <Avatar className="h-6 w-6 shrink-0">
                            <AvatarFallback className="text-xs">{mgrInitials}</AvatarFallback>
                          </Avatar>
                          <span className="flex-1 font-medium">{mgrName}</span>
                          {mgr.relationship && (
                            <span className="text-xs text-muted-foreground capitalize">{mgr.relationship}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
