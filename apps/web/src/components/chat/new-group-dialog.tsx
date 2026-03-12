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
import { Check, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/types/database";

type Channel = Database["public"]["Tables"]["channels"]["Row"];
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

export type GroupChannelWithUnread = Channel & { unreadCount: number };

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
  onGroupCreated: (channel: GroupChannelWithUnread) => void;
}) {
  const [groupName, setGroupName] = useState("");
  // selected stores the actual account profile IDs (resolved managers, not managed profile IDs)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

  function resolvedIds(m: TeamMemberWithProfile): string[] {
    if (m.managers.length === 0) return [m.profile_id!];
    return m.managers.map((mgr) => mgr.profileId);
  }

  function isAnySelected(m: TeamMemberWithProfile): boolean {
    return resolvedIds(m).some((id) => selected.has(id));
  }

  function toggleManager(profileId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(profileId) ? next.delete(profileId) : next.add(profileId);
      return next;
    });
  }

  function handleRowClick(m: TeamMemberWithProfile) {
    if (m.managers.length <= 1) {
      // Direct member or single manager — toggle
      const id = m.managers.length === 1 ? m.managers[0].profileId : m.profile_id!;
      toggleManager(id);
    } else {
      // Multiple managers — expand sub-picker
      setExpandedId((prev) => (prev === m.profile_id ? null : m.profile_id!));
    }
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
    setExpandedId(null);
    onGroupCreated({
      id: channelId,
      team_id: teamId,
      name: groupName.trim(),
      type: "group",
      created_by: currentUserId,
      created_at: new Date().toISOString(),
      unreadCount: 0,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setExpandedId(null); setMemberSearch(""); setGroupName(""); setSelected(new Set()); } }}>
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
            const anySelected = isAnySelected(m);
            const isExpanded = expandedId === m.profile_id;
            const multiManager = m.managers.length > 1;

            return (
              <div key={m.profile_id}>
                <button
                  onClick={() => handleRowClick(m)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    {p.avatar_url && <AvatarImage src={p.avatar_url} alt={name} />}
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{name}</span>
                    {m.managers.length === 1 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        via {m.managers[0].firstName}
                      </span>
                    )}
                  </div>
                  {multiManager ? (
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  ) : anySelected ? (
                    <Check className="h-4 w-4 text-primary" />
                  ) : null}
                </button>

                {/* Sub-picker for multiple managers */}
                {isExpanded && (
                  <div className="ml-11 mt-1 mb-1 space-y-0.5 border-l-2 border-muted pl-3">
                    <p className="text-xs text-muted-foreground py-1">Add contacts for {p.first_name}:</p>
                    {m.managers.map((mgr) => {
                      const mgrName = [mgr.firstName, mgr.lastName].filter(Boolean).join(" ");
                      const mgrInitials = ((mgr.firstName?.[0] ?? "") + (mgr.lastName?.[0] ?? "")).toUpperCase();
                      const isSel = selected.has(mgr.profileId);
                      return (
                        <button
                          key={mgr.profileId}
                          onClick={(e) => { e.stopPropagation(); return toggleManager(mgr.profileId); }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent transition-colors"
                        >
                          <Avatar className="h-6 w-6 shrink-0">
                            <AvatarFallback className="text-xs">{mgrInitials}</AvatarFallback>
                          </Avatar>
                          <span className="flex-1 font-medium">{mgrName}</span>
                          {mgr.relationship && (
                            <span className="text-xs text-muted-foreground capitalize mr-1">{mgr.relationship}</span>
                          )}
                          {isSel && <Check className="h-3.5 w-3.5 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
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
