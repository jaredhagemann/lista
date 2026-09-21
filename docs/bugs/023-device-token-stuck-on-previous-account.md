# BUG-023 — A device keeps the previous account's push token, and re-registration fails silently

**Severity:** P1
**Status:** Open — device repaired in production 2026-09-20; the app fix waits on a mobile build
**Reported:** 2026-09-18 by the user, from production behaviour
**Area:** notifications / ios
**Evidence class:** **Reproduced in production** (delivery records and subscription rows, 2026-09-18)

## Symptom

A phone signed in as one account receives another account's chat notifications, and receives nothing for
its own. The user saw it as "I got a notification about my own message": the handset was signed in as
account A, but its push token still belonged to account B, so a message A sent from the web arrived on A's
own phone — addressed to B.

Messages sent *to* A notified nobody, because A has no push subscription at all.

## Reproduction

**Reproduced in production, 2026-09-18.** Two accounts, one handset.

1. Register the device while signed in as B. The token row belongs to B.
2. Sign out, sign in as A on the same device.
3. Send a message from A on the web, to B.

**Expected:** A's phone has A's token; messages to A arrive there, and A's own messages do not.
**Actual:** the token row still belongs to B. A's message is delivered to that token — onto A's own
handset — and messages to A are recorded `skipped / no_subscription`.

## Evidence

Production `notification_deliveries`, 2026-09-18 22:16–22:18 UTC: two pushes to
`ExponentPushToken[z3f7…]`, recorded `sent`, both addressed to the account that registered it in April;
one delivery to the signed-in account recorded `skipped / no_subscription`. `push_subscriptions` holds one
row for that token, created 2026-04-15, owned by the other account.

- Registration: `apps/mobile/lib/notifications.ts` — `registerForPushNotifications`
- Sign-out: `apps/mobile/app/(app)/settings/index.tsx`
- The unique index: `supabase/migrations/20260918000000_chat_notification_jobs.sql`

## Cause

Two things, and the second is a deployment coupling introduced by the fix for
[BUG-007](./fixed/007-push-delivery-cannot-reach-audience.md).

1. **Signing out never detached the device.** The token row is bound to whoever registered it, so it
   survived the sign-out and kept pointing at the previous account.

2. **Re-registration under the new account fails silently on the installed build.** BUG-007 added
   `unique(expo_push_token)` so that registration could upsert and keep every device. The web deploys
   immediately; the phone runs whatever build is installed. The **old** build deletes its own Expo rows and
   then inserts — and with the token already owned by another account, that insert now violates the unique
   index. The old code never checked the error, so registration failed without a word.

   Before the index the same insert would have succeeded and created a *second* row for the same token, so
   both accounts would have pushed to the handset. Neither behaviour is right; the index turned a
   duplicate-delivery bug into a silent-failure one.

## Fix

Written, in the same PR as the chat-push fixes:

- sign-out detaches this device by token, leaving the person's other devices alone
- registration upserts on the token, so a device moves to whoever signs in on it
- both log when the write is refused, so the next silent failure is audible

**None of this reaches the handset until a new mobile build ships.** Until then the workaround is the SQL
under Verification.

**Decision, 2026-09-18 (user):** hold the build until the open bugs are worked through, and ship the mobile
changes together. Interim rule: **accept invitations on the web**, since the installed build still enrols the
parent as the player. What the build carries, and what stays broken until it does, is listed in
[docs/releases/mobile-next.md](../releases/mobile-next.md).

## Regression test

`apps/mobile/__tests__/chat-notify.test.ts`: registration upserts by token rather than deleting the
person's other devices; sign-out deletes by token, not by profile; a refused write is reported rather than
swallowed.

Not covered by tests: that the shipped build actually runs the new code — that is what the deploy check
below is for.

## Verification

**Immediate repair for the affected device** (production SQL, with the two profile ids):

```sql
-- Point the handset's token at the account now signed in on it.
update push_subscriptions
set profile_id = (select id from profiles where email = '<signed-in account>')
where expo_push_token = '<the token>';
```

**After the next mobile build ships**, on a device with two accounts:

1. Sign in as A, confirm `push_subscriptions` has a row for A with this device's token.
2. Sign out. Confirm the row is gone.
3. Sign in as B, send a message to B from elsewhere: it arrives. Send one *from* B: it does not come back.

**Repaired in production 2026-09-20 (user).** The handset's token was repointed to the account signed in on
it, and chat push to that device now works — confirmed by a message from another member arriving on the
phone.

Two things that repair also did, worth knowing if this recurs:

- It unblocked registration on the **installed** build for that device. The collision was with another
  account's row; with the row owned by the signed-in account, the old build's delete-then-insert succeeds
  again.
- It leaves the other account with no registered device, which matches the facts: one handset, one person
  signed into it.

The ticket stays open because the defect is not fixed, only its instance: any device that changes hands
before the new build ships will do the same thing, silently.
