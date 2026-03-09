"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type TeamMemberWithProfile = Database["public"]["Tables"]["team_members"]["Row"] & {
  profiles: Profile | null;
};

export function NewGroupDialog({
  open,
  onOpenChange,
  teamMembers,
  teamId,
  currentUserId,
  onGroupCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamMembers: TeamMemberWithProfile[];
  teamId: string;
  currentUserId: string;
  onGroupCreated: (channelId: string) => void;
}) {
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [memberSearch, setMemberSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const supabase = createClient();

  const others = teamMembers.filter(
    (m) => m.profile_id !== currentUserId && m.profiles
  );

  const filtered = memberSearch.trim()
    ? others.filter((m) => {
        const name = [m.profiles!.first_name, m.profiles!.last_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return name.includes(memberSearch.toLowerCase());
      })
    : others;

  function toggleMember(profileId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) {
        next.delete(profileId);
      } else {
        next.add(profileId);
      }
      return next;
    });
  }

  async function create() {
    if (!groupName.trim()) {
      toast.error("Please enter a group name");
      return;
    }
    setCreating(true);

    const channelId = crypto.randomUUID();
    const { error: channelError } = await supabase.from("channels").insert({
      id: channelId,
      team_id: teamId,
      name: groupName.trim(),
      type: "group",
      created_by: currentUserId,
    });

    if (channelError) {
      toast.error("Failed to create group");
      setCreating(false);
      return;
    }

    // Add creator + selected members
    const memberIds = [currentUserId, ...Array.from(selected)];
    const { error: membersError } = await supabase.from("channel_members").insert(
      memberIds.map((id) => ({ channel_id: channelId, profile_id: id }))
    );

    if (membersError) {
      toast.error("Failed to add members");
      setCreating(false);
      return;
    }

    setCreating(false);
    setGroupName("");
    setSelected(new Set());
    setMemberSearch("");
    onGroupCreated(channelId);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New Group</DialogTitle>
        </DialogHeader>

        <Input
          placeholder="Group name"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          autoFocus
        />

        <Input
          placeholder="Search members to add…"
          value={memberSearch}
          onChange={(e) => setMemberSearch(e.target.value)}
        />

        <div className="max-h-48 overflow-y-auto space-y-1">
          {filtered.map((m) => {
            const p = m.profiles!;
            const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
            const initials = [p.first_name, p.last_name]
              .filter(Boolean)
              .map((n) => n[0])
              .join("")
              .toUpperCase();
            const isSelected = selected.has(m.profile_id!);
            return (
              <button
                key={m.profile_id}
                onClick={() => toggleMember(m.profile_id!)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  {p.avatar_url && <AvatarImage src={p.avatar_url} alt={name} />}
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <span className="flex-1 font-medium">{name}</span>
                {isSelected && <Check className="h-4 w-4 text-primary" />}
              </button>
            );
          })}
        </div>

        {selected.size > 0 && (
          <p className="text-xs text-muted-foreground">
            {selected.size} member{selected.size !== 1 ? "s" : ""} selected
          </p>
        )}

        <Button onClick={create} disabled={creating || !groupName.trim()}>
          {creating ? "Creating…" : "Create Group"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
