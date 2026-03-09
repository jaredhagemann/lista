"use client";

import { useState, useSyncExternalStore } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export type MessageWithProfile = Database["public"]["Tables"]["messages"]["Row"] & {
  profiles: Profile | null;
};

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  if (isToday) return timeStr;
  if (isYesterday) return `Yesterday ${timeStr}`;
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${timeStr}`;
}

export function MessageItem({
  message,
  isOwn,
  isAdmin,
}: {
  message: MessageWithProfile;
  isOwn: boolean;
  isAdmin: boolean;
}) {
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);

  const profile = message.profiles;
  const fullName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(" ")
    : "Unknown";
  const initials = profile
    ? [profile.first_name, profile.last_name]
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : "?";

  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  const isDeleted = message.deleted_at !== null;

  async function handleDelete() {
    setDeleting(true);
    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", message.id);
    if (error) {
      toast.error("Failed to delete message");
    }
    setDeleting(false);
  }

  if (isDeleted) {
    return (
      <div className={`flex items-end gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
        {!isOwn && <div className="h-8 w-8 shrink-0" />}
        <p className="text-xs text-muted-foreground italic px-2">Message deleted</p>
      </div>
    );
  }

  const canDelete = isOwn || isAdmin;

  return (
    <div className={`group flex items-end gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
      {!isOwn && (
        <Avatar className="h-8 w-8 shrink-0">
          {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={fullName} />}
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
      )}

      <div className={`flex max-w-[70%] flex-col gap-1 ${isOwn ? "items-end" : "items-start"}`}>
        {!isOwn && (
          <span className="text-xs text-muted-foreground px-1">{fullName}</span>
        )}
        <div className="flex items-end gap-1">
          {mounted && canDelete && isOwn && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div
            className={`rounded-2xl px-3 py-2 text-sm ${
              isOwn
                ? "bg-primary text-primary-foreground rounded-br-sm"
                : "bg-muted rounded-bl-sm"
            }`}
          >
            {message.body}
          </div>
          {mounted && canDelete && !isOwn && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground px-1">
          {formatTime(message.created_at!)}
        </span>
      </div>
    </div>
  );
}
