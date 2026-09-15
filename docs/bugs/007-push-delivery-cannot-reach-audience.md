# BUG-007 — Push notifications cannot reach their intended recipients

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 7)
**Area:** notifications

## Symptom

Push fan-out for events and chat resolves **zero** recipient tokens, so notifications are silently not
delivered even when the sending path runs correctly.

## Reproduction

**Reproduced at the database boundary; code-confirmed in the routes.**

1. As a coach with teammates who have registered push subscriptions, trigger an event notification.
2. Observe the tokens the route resolves.

**Expected:** the route resolves every intended recipient's active tokens.
**Actual:** zero teammate tokens are visible; chat additionally excludes the caller, leaving no recipients
at all.

## Evidence

- Event fan-out: `apps/web/src/app/api/notifications/send/route.ts:158`
- Chat fan-out: `apps/web/src/app/api/chat/notify/route.ts:126`
- Token RLS: `supabase/migrations/20260101000000_initial_schema.sql:227`
- Guardian reminder targeting: `apps/web/src/app/api/cron/reminders/route.ts:65`
- Mobile token replacement: `apps/mobile/lib/notifications.ts:57`
- Native chat send: `apps/mobile/app/(app)/chat/[channelId].tsx:121`

## Cause

The notification routes use the **caller's** cookie-authenticated Supabase client, while `push_subscriptions`
RLS permits reading only the caller's own rows. The fan-out therefore sees nothing to send to.

Five compounding gaps sit on top of that root cause, and each needs its own fix:

1. Native message senders insert messages without invoking the notification route at all.
2. Push queries use player roster IDs rather than expanding to guardian account IDs, so a parent managing a
   child without their own roster row is missed — including by the service-role reminder job.
3. Preference reads on user-scoped routes cannot see other users' preferences and default missing rows to
   enabled; guardian emails are filtered by the *child's* preference rather than the receiving adult's.
4. Mobile token registration deletes **all** prior Expo tokens for the user, so registering a second device
   silently disables delivery to the first.
5. Send errors are logged or swallowed with no durable delivery record or retry queue, and chat shares a
   30-per-hour sender rate limit with event notifications.

## Fix

Authorize the initiating action first, then resolve recipient accounts and their preferences in a **trusted
worker** (service role), not the caller's client. Support multiple devices per user, idempotent jobs,
retries and delivery monitoring.

**Do not** make push tokens publicly readable to work around the RLS policy.

Related: [[006]] (mutations that never dispatch) and [[008]] (the reminder cron never runs).

## Regression test

Assert recipient resolution for: a teammate, a guardian without a roster row, a user with two registered
devices, and a user who has disabled the relevant preference.
