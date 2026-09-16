# BUG-007 — Push notifications cannot reach their intended recipients

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 7)
**Area:** notifications
**Evidence class:** Mixed — token visibility Reproduced at the database boundary; route behavior Static
**Last verified:** `5acde1074`, local stack + code inspection, 2026-09-04

## Symptom

Push fan-out cannot resolve the people it is meant to reach. **Other intended recipients' tokens are hidden
from the sending path** — the caller's own tokens can still be visible, so this is not literally "zero
tokens" for events. Chat additionally excludes the caller from its recipient list, so its ordinary fan-out
can end with no recipients at all.

## Reproduction

**Reproduced at the database boundary** (probe); **static** for the route behavior. No end-to-end
"notification did not arrive on a device" test was run.

1. As a coach with teammates who have registered push subscriptions, resolve recipients the way the route
   does — through the caller's cookie-authenticated client.
2. Observe which tokens are visible.

**Expected:** every intended recipient's active tokens resolve.
**Actual:** teammate tokens are not visible to the caller; chat, which excludes the caller, is left with
none.

## Evidence

- Event fan-out: `apps/web/src/app/api/notifications/send/route.ts:158`
- Chat fan-out: `apps/web/src/app/api/chat/notify/route.ts:126`
- Token RLS: `supabase/migrations/20260101000000_initial_schema.sql:227`
- Guardian reminder targeting: `apps/web/src/app/api/cron/reminders/route.ts:65`
- Mobile token replacement: `apps/mobile/lib/notifications.ts:57`
- Native chat send: `apps/mobile/app/(app)/chat/[channelId].tsx:121`

## Product decisions

Settled as **D2** in `docs/reviews/2026-09-15-bug-backlog-review.md`, 2026-09-15.

**Important correction to the original ticket:** the child's preferences controlling fan-out to all managers
was a *specified* behavior (`docs/specs/archive/managed-profiles.md:189`), not a defect. It has now been
deliberately superseded — but it was never independently a bug, and the distinction matters for how the
change is rolled out.

| Question | Decision | Date |
| --- | --- | --- |
| Whose preferences apply? | **Each receiving adult controls their own** event and chat preferences. Supersedes the archived child-preference rule. | 2026-09-15 |
| Who is eligible? | All authorized guardians | 2026-09-15 |
| Repeated alerts? | Duplicate membership/child paths must not send the same generic event alert repeatedly to one adult. Preserve child-specific content where separate notifications carry different information. | 2026-09-15 |
| Migration of existing settings | For each category, if **either** the adult's own profile **or** any child they manage is opted out, start that category **disabled** for that adult; otherwise keep the enabled default. | 2026-09-15 |

The migration rule is deliberately conservative. With today's profile-wide preferences it can also silence a
category for another child whose setting was enabled — **accepted by the user**. **Inventory the affected
records before applying the migration.**

Also already decided, do not reopen: separate chat push, chat digest and event preferences; chat has no
per-message email; mobile push needs a per-device opt-out
(`docs/specs/archive/team-chat.md:237`). Organization directors must **not** all become subscribers merely
through implicit administrative access (`docs/specs/multi-tenant-architecture.md:379`).

## Cause

**Root cause:** the notification routes use the **caller's** cookie-authenticated Supabase client, while
`push_subscriptions` RLS permits reading only the caller's own rows.

Five compounding gaps sit on top of it. **Each is independently verifiable and should be tracked with its
own acceptance checkbox** — they are not one fix:

1. Native message senders insert messages without invoking the notification route at all.
2. Push queries use player roster IDs rather than expanding to guardian account IDs, so a parent managing a
   child without their own roster row is missed — including by the service-role reminder job.
3. Preference reads on user-scoped routes cannot see other users' preferences and default missing rows to
   enabled. (The *policy* here is settled by D2 above; the **lookup** is the defect.)
4. Mobile token registration deletes **all** prior Expo tokens for the user, so registering a second device
   silently disables delivery to the first.
5. Send errors are logged or swallowed with no durable delivery record or retry queue, and chat shares a
   30-per-hour sender rate limit with event notifications.

## Proposed fix

Authorize the initiating action first, then resolve recipient accounts and their preferences in a **trusted
worker** (service role), not the caller's client. Support multiple devices per user, idempotent jobs,
retries and delivery monitoring.

**Do not** make push tokens publicly readable to work around the RLS policy.

Gaps 1, 2, 4 and the caller-scoped token lookup can all be fixed **without** waiting for the preference
migration in D2.

Related: [BUG-006](./006-schedule-changes-do-not-notify.md) (mutations that never dispatch) and
[BUG-008](./008-cron-routes-redirected-to-login.md) (the reminder cron never runs).

## Regression test

One acceptance check per numbered gap above, plus recipient resolution for: a teammate, a guardian without
a roster row, a user with two registered devices (both must survive registration), and a user who has
disabled the relevant category under the D2 rules.

Assert an org director does not receive team notifications merely through administrative access.
