"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus } from "lucide-react";
import { NewDmDialog } from "./new-dm-dialog";
import { NewGroupDialog } from "./new-group-dialog";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Channel = Database["public"]["Tables"]["channels"]["Row"];
type DmChannel = Database["public"]["Tables"]["dm_channels"]["Row"];
type TeamMemberWithProfile = Database["public"]["Tables"]["team_members"]["Row"] & {
  profiles: Profile | null;
};

export type SelectedChannel =
  | { type: "team" | "group"; id: string }
  | { type: "dm"; id: string };

export type DmChannelWithProfile = DmChannel & {
  otherProfile: Profile;
  unreadCount: number;
};

export function ChannelList({
  teamChannel,
  teamChannelUnread,
  groupChannels,
  dmChannels,
  teamMembers,
  teamId,
  currentUserId,
  selected,
  onSelect,
  onDmCreated,
  onGroupCreated,
}: {
  teamChannel: Channel | null;
  teamChannelUnread: number;
  groupChannels: (Channel & { unreadCount: number })[];
  dmChannels: DmChannelWithProfile[];
  teamMembers: TeamMemberWithProfile[];
  teamId: string;
  currentUserId: string;
  selected: SelectedChannel | null;
  onSelect: (ch: SelectedChannel) => void;
  onDmCreated: (dmChannelId: string) => void;
  onGroupCreated: (channelId: string) => void;
}) {
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);

  function handleDmCreated(dmChannelId: string) {
    onDmCreated(dmChannelId);
    onSelect({ type: "dm", id: dmChannelId });
  }

  function handleGroupCreated(channelId: string) {
    onGroupCreated(channelId);
    onSelect({ type: "group", id: channelId });
  }

  return (
    <>
      <div className="flex h-full flex-col border-r">
        <div className="border-b px-3 py-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Chat
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {/* Team Channel */}
          {teamChannel && (
            <div className="px-2 mb-4">
              <ChannelItem
                label={teamChannel.name}
                unread={teamChannelUnread}
                isActive={selected?.type !== "dm" && selected?.id === teamChannel.id}
                onClick={() => onSelect({ type: "team", id: teamChannel.id })}
                icon="#"
              />
            </div>
          )}

          {/* Direct Messages */}
          <div className="px-2 mb-4">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Direct Messages
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => setNewDmOpen(true)}
                title="New Message"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            {dmChannels.length === 0 && (
              <p className="px-2 text-xs text-muted-foreground py-1">No conversations yet</p>
            )}
            {dmChannels.map((dm) => {
              const name = [dm.otherProfile.first_name, dm.otherProfile.last_name]
                .filter(Boolean)
                .join(" ");
              const initials = [dm.otherProfile.first_name, dm.otherProfile.last_name]
                .filter(Boolean)
                .map((n) => n[0])
                .join("")
                .toUpperCase();
              return (
                <button
                  key={dm.id}
                  onClick={() => onSelect({ type: "dm", id: dm.id })}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    selected?.id === dm.id
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                >
                  <Avatar className="h-6 w-6 shrink-0">
                    {dm.otherProfile.avatar_url && (
                      <AvatarImage src={dm.otherProfile.avatar_url} alt={name} />
                    )}
                    <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate text-left">{name}</span>
                  {dm.unreadCount > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                      {dm.unreadCount > 99 ? "99+" : dm.unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Groups */}
          <div className="px-2">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Groups
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => setNewGroupOpen(true)}
                title="New Group"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            {groupChannels.length === 0 && (
              <p className="px-2 text-xs text-muted-foreground py-1">No groups yet</p>
            )}
            {groupChannels.map((ch) => (
              <ChannelItem
                key={ch.id}
                label={ch.name}
                unread={ch.unreadCount}
                isActive={selected?.id === ch.id}
                onClick={() => onSelect({ type: "group", id: ch.id })}
                icon="#"
              />
            ))}
          </div>
        </div>
      </div>

      <NewDmDialog
        open={newDmOpen}
        onOpenChange={setNewDmOpen}
        teamMembers={teamMembers}
        teamId={teamId}
        currentUserId={currentUserId}
        onDmCreated={handleDmCreated}
      />

      <NewGroupDialog
        open={newGroupOpen}
        onOpenChange={setNewGroupOpen}
        teamMembers={teamMembers}
        teamId={teamId}
        currentUserId={currentUserId}
        onGroupCreated={handleGroupCreated}
      />
    </>
  );
}

function ChannelItem({
  label,
  unread,
  isActive,
  onClick,
  icon,
}: {
  label: string;
  unread: number;
  isActive: boolean;
  onClick: () => void;
  icon: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      {unread > 0 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
