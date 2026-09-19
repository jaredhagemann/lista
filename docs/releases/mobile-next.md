# Mobile release notes — next build

**Status:** unreleased. Everything below is merged to `main` and live on the web, but **only reaches phones
when a new build ships**.
**Current shipped version:** 1.0.0 (`apps/mobile/app.json`)
**Decision, 2026-09-18 (user):** hold the build until the open bug list is worked through, and ship these
together.

The point of this file is that "waiting on a build" is easy to forget. Each entry says what is broken on the
**installed** build, so the cost of waiting stays visible.

---

## Until this build ships

**Accept invitations on the web, not in the app.** It is the one deferred fix whose absence creates data
someone then has to repair: the installed build enrols the signed-in parent *as the player*. Chat and
notification gaps are annoyances; a wrong identity is a merge.

**Schema changes must tolerate the installed build.** This bit us once already —
[BUG-023](../bugs/023-device-token-stuck-on-previous-account.md) below — when a unique index written for the
new app broke registration on the old one.

---

## What is in the build

### Invitation acceptance asks who you are — [BUG-011](../bugs/fixed/011-identity-differs-web-vs-mobile.md)

**Installed build:** sends `self` for every invitation that is not a "manage an existing player" invite. A
parent accepting their child's player invitation is enrolled **as the player**, and the invitation's
birthday and gender land on the parent's profile.

**New build:** the screen asks *"Are you {player}?"*, the same question the web screen asks. A guardian picks
their relationship, and — when they already manage children — picks the child this invitation is for, so a
second team joins the existing child instead of creating a second record. An unanswered question is an
error rather than a guess.

Files: `app/invite/[id].tsx`, `lib/invite-accept.ts`, `__tests__/invite-accept.test.ts`.

### Messages sent from the phone notify people — [BUG-007](../bugs/fixed/007-push-delivery-cannot-reach-audience.md) gap 1

**Installed build:** inserts the message and stops. A message typed on a phone reaches nobody's lock screen;
the web client has always made this call.

**New build:** both chat screens post to `/api/chat/notify` with a bearer token after the message is saved.
Best effort by design — a failed call costs a notification, not the message.

Files: `app/(app)/chat/[channelId].tsx`, `app/(app)/chat/dm/[dmId].tsx`, `lib/chat-notify.ts`.

### A second device no longer silences the first — [BUG-007](../bugs/fixed/007-push-delivery-cannot-reach-audience.md) gap 4

**Installed build:** registration deletes every other Expo token the person has, then inserts. Installing on
a tablet silently stops delivery to the phone.

**New build:** registration upserts on the token itself, so every device keeps working, a reinstall refreshes
the row, and a handset moves to whoever signs in on it.

Files: `lib/notifications.ts`.

### Signing out detaches the handset — [BUG-023](../bugs/023-device-token-stuck-on-previous-account.md)

**Installed build:** the token row stays bound to the account that registered it. The handset keeps receiving
that account's notifications, and whoever signs in next sees them. Re-registering under the new account
fails silently, because the insert collides with the unique index the server now has.

**New build:** sign-out deletes this device's row by token, leaving the person's other devices alone, and both
registration and unregistration report a refused write instead of swallowing it.

Files: `lib/notifications.ts`, `app/(app)/settings/index.tsx`.

---

## Before shipping

1. `cd apps/mobile && npx jest` — the suites run and pass (they were thought broken until 2026-09-17; see
   [BUG-018](../bugs/fixed/018-mobile-jest-suites-fail-to-start.md)).
2. `cd apps/mobile && npx tsc --noEmit`.
3. Bump `version` in `apps/mobile/app.json`.
4. Check that no schema change since the last build assumes behaviour only this build has.

## After shipping

Each of these is the check recorded on its ticket, and none of them can be run before the build exists:

- **BUG-011:** invite a player whose guardian already manages a child on another team; accept **in the app**
  as the guardian. The app asks who you are, offers the child by name, and the existing child gains a team.
- **BUG-007 gap 1:** send a chat message from the app; another member's phone receives it.
- **BUG-007 gap 4:** register a second device, send again, and confirm **both** receive it.
- **BUG-023:** sign in as A and confirm a `push_subscriptions` row exists for A with this device's token;
  sign out and confirm it is gone; sign in as B and confirm messages to B arrive while B's own do not come
  back.

Then move BUG-023 to `fixed/`, and record the deploy verification on BUG-007 and BUG-011.
