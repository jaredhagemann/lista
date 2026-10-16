# BUG-036 — A web tab keeps acting as the account it loaded with after another sign-in

**Severity:** P2 (see Severity note)
**Status:** Open
**Reported:** 2026-10-16 by the product owner, testing with two accounts in one browser
**Area:** auth, web
**Evidence class:** Mixed — see below
**Last verified:** `a20cfb146` (main), by code inspection

## Symptom

A newly created account, in a browser where another account had been signed in:
- **Chat:** the page loaded, but every message failed with "Failed to send".
- **Profile:** saving a changed name showed "Profile updated", but nothing changed.
- **After reloading:** both worked. Mobile was unaffected.

## Reproduction

As reported:
1. Sign in to the web as account A, in one tab.
2. In the same browser, sign up (or sign in) as account B, so the session cookies now belong to B.
3. In a page that hasn't fully reloaded since the switch, send a chat message, or save a profile change.

**Expected:** the page acts as the account it shows, or reloads as the new one.
**Actual:** the page shows B, from the server render, but its browser client still holds the session it had
at load. Writes then go as A, or as no one, and the permission rules refuse them.

**Evidence class.**
- **Reproduced:** the symptoms, by the product owner on the web. They went away after a reload. The ticket
  doesn't say which environment.
- **Static:** the mechanism, by code inspection. It hasn't been reproduced step by step: which tab and order
  the owner used is unknown.

## Evidence

- `apps/web/src/lib/supabase/client.ts`: `createBrowserClient` from `@supabase/ssr` is a singleton in the
  browser, and keeps its session in memory from load.
- **No listener:** nothing in `apps/web/src` calls `onAuthStateChange`. A tab never learns that the session
  cookies changed under it, from another tab, a sign-out or a new sign-up.
- **Pages are server-rendered,** with the middleware's refreshed cookies (`src/lib/supabase/middleware.ts`),
  so they show the cookie's account.
- **Writes are made by the browser client,** as the account it holds:
  - Chat sends with the page's `sender_id`. `messages_insert` requires `sender_id = auth.uid()`
    (`supabase/migrations/20260917000004_chat_access_control.sql:174`), so a mismatch is refused, and
    `message-input.tsx` shows "Failed to send".
  - The profile form updates `profiles` by the page's profile id. The update policy only reaches
    `id = auth.uid()` or managed profiles (`20260303000002_managed_profiles.sql:108`). Under another account
    it matches no rows, without an error, which BUG-037 turns into a false "Profile updated".

**Severity note.** It needs two accounts in one browser. That's common in testing, and also on a shared family
computer, a parent's account and a player's. At worst, a write the old account is itself allowed to make
succeeds as that account, for example an availability answer or an event edit by a coach on both teams.
That's wrong attribution, not a bypass, because both accounts are signed in on that device. It's P2 because a
reload is the workaround. Regrade to P1 if a wrongly attributed write is confirmed.

## Product decisions

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| What should an open tab do when the signed-in account changes under it? | Do a full reload of the dashboard (`/dashboard`) as the new account, so no state from the old one survives. If the session ends instead (signed out elsewhere), go to `/login`. A token refresh for the same user changes nothing | Open | | |

## Cause

The web's browser client takes its session at load and never re-reads it. No part of the app listens for
auth changes and re-syncs, so a page can show one account while it writes as another.

## Proposed fix

- **Add an auth listener** in the dashboard layout's client shell. On `onAuthStateChange`, compare the event's
  user id with the id the page was rendered for:
  - a different user: do the decided reload
  - signed out: go to `/login`
  - the same user, after a token refresh: nothing
- **Cover tabs it can't hear from.** A session change made in another tab reaches this one only when its
  client next reads the cookies. Also re-check on `visibilitychange` and focus, with `getUser()` against the
  rendered id.

## Regression test

In `apps/web/tests/`, with the auth client mocked:
- the listener reloads to `/dashboard` when a `SIGNED_IN` event carries another user
- it goes to `/login` on `SIGNED_OUT`
- it does nothing on `TOKEN_REFRESHED` for the same user (the legitimate path)
- regaining focus with a different `getUser()` result also reloads

The first and last fail against the current code, which has no listener.

---

<!-- Everything below is filled in only when the bug is actually fixed, in the same PR. -->

## Fix as implemented

**Branch:** `fix/036-web-session-switch`
**PR:** #NN
**Migration:** none

## Verification

**Test:** `apps/web/tests/…`
