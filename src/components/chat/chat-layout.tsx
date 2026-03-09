"use client";

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChannelList, type SelectedChannel, type DmChannelWithProfile } from "./channel-list";
import { MessageThread } from "./message-thread";
import { type MessageWithProfile } from "./message-item";
import type { Database } from "@/types/database";

type Channel = Database["public"]["Tables"]["channels"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type TeamMemberWithProfile = Database["public"]["Tables"]["team_members"]["Row"] & {
  profiles: Profile | null;
};

export function ChatLayout({
  teamChannel,
  teamChannelUnread,
  groupChannels,
  dmChannels,
  teamMembers,
  initialMessages,
  teamId,
  currentUserId,
  currentUserProfile,
  isAdmin,
}: {
  teamChannel: Channel | null;
  teamChannelUnread: number;
  groupChannels: (Channel & { unreadCount: number })[];
  dmChannels: DmChannelWithProfile[];
  teamMembers: TeamMemberWithProfile[];
  initialMessages: MessageWithProfile[];
  teamId: string;
  currentUserId: string;
  currentUserProfile: Profile | null;
  isAdmin: boolean;
}) {
  const defaultChannel: SelectedChannel | null = teamChannel
    ? { type: "team", id: teamChannel.id }
    : null;

  const [selected, setSelected] = useState<SelectedChannel | null>(defaultChannel);
  const [allGroupChannels] = useState(groupChannels);
  const [allDmChannels, setAllDmChannels] = useState(dmChannels);
  const [messages, setMessages] = useState<MessageWithProfile[]>(initialMessages);
  const [showList, setShowList] = useState(true); // mobile: show list or thread

  // Find the active channel/dm objects
  const activeChannel =
    selected?.type !== "dm"
      ? selected?.id === teamChannel?.id
        ? teamChannel
        : allGroupChannels.find((c) => c.id === selected?.id) ?? null
      : null;

  const activeDm =
    selected?.type === "dm"
      ? allDmChannels.find((d) => d.id === selected.id) ?? null
      : null;

  async function handleSelect(ch: SelectedChannel) {
    setSelected(ch);
    setShowList(false); // mobile: switch to thread view
    setMessages([]); // clear while loading; MessageThread will fetch via subscription
  }

  function handleDmCreated(dm: DmChannelWithProfile) {
    setAllDmChannels((prev) => prev.some((d) => d.id === dm.id) ? prev : [...prev, dm]);
    setSelected({ type: "dm", id: dm.id });
    setShowList(false);
  }

  function handleGroupCreated(channelId: string) {
    setSelected({ type: "group", id: channelId });
    setShowList(false);
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem-48px)] overflow-hidden rounded-lg border">
      {/* Channel list — always visible on desktop; toggleable on mobile */}
      <div
        className={`w-full md:w-64 md:flex flex-shrink-0 ${
          showList ? "flex" : "hidden md:flex"
        }`}
      >
        <ChannelList
          teamChannel={teamChannel}
          teamChannelUnread={teamChannelUnread}
          groupChannels={allGroupChannels}
          dmChannels={allDmChannels}
          teamMembers={teamMembers}
          teamId={teamId}
          currentUserId={currentUserId}
          selected={selected}
          onSelect={handleSelect}
          onDmCreated={handleDmCreated}
          onGroupCreated={handleGroupCreated}
        />
      </div>

      {/* Message thread */}
      <div
        className={`flex-1 flex flex-col overflow-hidden ${
          !showList ? "flex" : "hidden md:flex"
        }`}
      >
        {/* Mobile back button */}
        <div className="md:hidden border-b px-2 py-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowList(true)}
            className="gap-1 text-sm"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
        </div>

        {selected ? (
          <MessageThread
            key={selected.id}
            initialMessages={messages}
            channel={activeChannel ?? undefined}
            dmChannel={activeDm ?? undefined}
            currentUserId={currentUserId}
            currentUserProfile={currentUserProfile}
            isAdmin={isAdmin}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            Select a channel to start chatting
          </div>
        )}
      </div>
    </div>
  );
}
