// @vitest-environment jsdom
/**
 * BUG-035: a chat message keeps its line breaks on the web
 * (docs/bugs/fixed/035-chat-line-breaks-collapsed-on-web.md).
 *
 * Bodies are stored with their newlines; the bubble must not collapse them. jsdom
 * doesn't lay text out, so this checks what the fix controls: the bubble holds the
 * whole body, newlines included, and preserves whitespace.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MessageItem, type MessageWithProfile } from "@/components/chat/message-item";

function message(body: string): MessageWithProfile {
  return {
    id: "m-1",
    body,
    sender_id: "p-2",
    created_at: "2026-10-16T17:00:00Z",
    deleted_at: null,
    profiles: { first_name: "Casey", last_name: "Coach" },
  } as unknown as MessageWithProfile;
}

/** The bubble: the element whose text is the body. */
function bubble(body: string) {
  const el = screen.getByText((_, node) => node?.textContent === body && node.children.length === 0);
  return el as HTMLElement;
}

afterEach(cleanup);

describe("BUG-035: chat line breaks", () => {
  it("a message in sections keeps its line breaks", () => {
    const body = "Saturday plan:\n\n- Arrive 8:30\n- White jerseys";
    render(<MessageItem message={message(body)} isOwn={false} isAdmin={false} />);

    const el = bubble(body);
    expect(el.textContent).toBe(body);
    expect(el.className).toMatch(/\bwhitespace-pre-wrap\b/);
    expect(el.className).toMatch(/\bbreak-words\b/);
  });

  it("your own message too", () => {
    const body = "Line one\nLine two";
    render(<MessageItem message={message(body)} isOwn isAdmin={false} />);

    expect(bubble(body).className).toMatch(/\bwhitespace-pre-wrap\b/);
  });

  it("a one-line message reads as before", () => {
    render(<MessageItem message={message("See you there")} isOwn={false} isAdmin={false} />);

    expect(screen.getByText("See you there")).toBeTruthy();
  });
});
