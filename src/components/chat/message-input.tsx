"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

const MAX_LENGTH = 4000;

export function MessageInput({
  channelId,
  dmChannelId,
  senderId,
  onOptimisticSend,
}: {
  channelId?: string;
  dmChannelId?: string;
  senderId: string;
  onOptimisticSend: (messageId: string, body: string) => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const supabase = createClient();

  const remaining = MAX_LENGTH - body.length;
  const canSend = body.trim().length > 0 && body.length <= MAX_LENGTH && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true);
    const trimmed = body.trim();
    const messageId = crypto.randomUUID();

    const { error } = await supabase.from("messages").insert({
      id: messageId,
      channel_id: channelId ?? null,
      dm_channel_id: dmChannelId ?? null,
      sender_id: senderId,
      body: trimmed,
    });

    if (error) {
      toast.error("Failed to send message");
      setSending(false);
      return;
    }

    // Immediately add the message to the UI without waiting for Realtime
    onOptimisticSend(messageId, trimmed);

    setBody("");
    // Resize textarea back to default
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Fire-and-forget push notification
    fetch("/api/chat/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, channelId, dmChannelId }),
    }).catch(() => {});

    setSending(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function handleInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  return (
    <div className="border-t bg-background p-3">
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="Message… (Enter to send, Shift+Enter for new line)"
            rows={1}
            className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            style={{ minHeight: "40px", maxHeight: "160px" }}
          />
          {remaining < 200 && (
            <span
              className={`absolute bottom-2 right-2 text-[10px] ${
                remaining < 0 ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {remaining}
            </span>
          )}
        </div>
        <Button size="icon" onClick={send} disabled={!canSend} className="shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
