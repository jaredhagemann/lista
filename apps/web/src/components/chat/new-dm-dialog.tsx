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
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/types/database";
import type { DmChannelWithProfile } from "./channel-list";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type TeamMemberWithProfile = Database["public"]["Tables"]["team_members"]["Row"] & {
  profiles: Profile | null;
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

    // Upsert DM channel
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

    // Fetch the (possibly existing) DM channel
    const { data: dm } = await supabase
      .from("dm_channels")
      .select("*")
      .eq("team_id", teamId)
      .eq("profile_a", profileA)
      .eq("profile_b", profileB)
      .single();

    setLoading(null);
    if (dm) {
      const otherProfile = teamMembers.find((m) => m.profile_id === profileId)?.profiles;
      if (!otherProfile) { setLoading(null); return; }
      onDmCreated({ ...dm, otherProfile, unreadCount: 0 });
      onOpenChange(false);
      setSearch("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
        <div className="max-h-64 overflow-y-auto space-y-1">
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
            return (
              <button
                key={m.profile_id}
                onClick={() => startDm(m.profile_id!)}
                disabled={loading === m.profile_id}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  {p.avatar_url && <AvatarImage src={p.avatar_url} alt={name} />}
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium">{name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{m.role}</p>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
