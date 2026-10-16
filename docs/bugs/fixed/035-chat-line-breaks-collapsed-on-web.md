# BUG-035 — Chat messages lose their line breaks on the web

**Severity:** P3
**Status:** Fixed
**Reported:** 2026-10-16 by the product owner, using chat
**Area:** chat, web
**Evidence class:** Mixed — see below
**Last verified:** `6c1ec61ba` (main), by code inspection

## Symptom

A message written in several lines or sections shows on the web as one long paragraph. The line breaks are
gone, whether the message was sent from the web (Shift+Enter) or from the phone.

## Reproduction

1. In a team channel or DM on the web, type a line, press Shift+Enter, type another line, and send.
2. Look at the message in the thread.

**Expected:** the message shows on two lines, as typed.
**Actual:** it shows as one line, the break replaced by a space.

**Evidence class.**
- **Reproduced:** the symptom, by the product owner. The ticket doesn't say which environment.
- **Static:** the cause, by code inspection. That the phone displays line breaks is also static; it hasn't
  been checked on a device.

## Evidence

- `apps/web/src/components/chat/message-item.tsx:126-134`: the bubble renders `{message.body}` in a plain
  `<div>`, with no `white-space` style. HTML displays newlines as single spaces.
- The text is stored intact:
  - The web input (`message-input.tsx:33`) and the mobile one (`MessageInput.tsx:22`) only `trim()` the ends.
  - No migration rewrites `messages.body`.
- `apps/mobile/components/chat/MessageItem.tsx:84-85`: React Native's `<Text>` keeps `\n`, so the phone
  should already display the breaks.

## Cause

The web's message bubble doesn't preserve whitespace, so the browser collapses the newlines stored in the body.

## Proposed fix

Add `whitespace-pre-wrap` to the bubble, so it keeps line breaks and still wraps long lines. Also add
`break-words`, so a long unbroken link wraps instead of stretching the bubble. Web only, with no migration.
Messages already sent display correctly once deployed, since their newlines are stored.

## Regression test

`apps/web/tests/`: render `MessageItem` with a two-line body. The bubble holds the full body, newline included,
and preserves whitespace. A one-line body renders as before. The whitespace check fails against the current
bubble.

---

<!-- Everything below is filled in only when the bug is actually fixed, in the same PR. -->

## Fix as implemented

**Branch:** `fix/035-chat-line-breaks`
**PR:** #133
**Migration:** none

`apps/web/src/components/chat/message-item.tsx`: the bubble has `whitespace-pre-wrap`, so the newlines stored in
a body display, and long lines still wrap. It also has `break-words`, so a long unbroken link wraps inside the
bubble. This applies to every message, including those already sent. No change to the input, storage or mobile.

## Verification

**Test:** `apps/web/tests/chat-message-line-breaks.test.tsx`, against the real `MessageItem`:
- "a message in sections keeps its line breaks": fails against the unfixed bubble. The body is intact but whitespace isn't preserved
- "your own message too": also fails against it
- "a one-line message reads as before": passes on both

The full web suite passes (112 files, 1,520 tests). `tsc --noEmit` and eslint are clean.

**Deployment verification:** none required. This is a style change with no migration. After deploy, a multi-line
message on the web shows its lines. Checking the phone display on a device would turn its static evidence into
a reproduction.
