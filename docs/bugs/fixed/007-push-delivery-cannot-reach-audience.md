# BUG-007 — Push notifications cannot reach their intended recipients

**Severity:** P1
**Status:** Fixed (pending deploy verification — see Verification)
**Reported:** 2026-09-04 by readiness review (finding 7)
**Area:** notifications
**Evidence class:** Mixed — token visibility Reproduced at the database boundary; route behavior Static. Fix **unverified in deployment**
**Last verified:** `5acde1074`, local stack + code inspection, 2026-09-04

**Event fan-out fixed first by [BUG-006](./006-schedule-changes-do-not-notify.md) (2026-09-17):** schedule
changes now go out through a job queue drained by the service role, so every intended recipient resolves,
guardians of managed players included. What remains here: the chat fan-out (`/api/chat/notify`), mobile
token replacement, guardian targeting in the reminders cron, and retiring the now-unused
`/api/notifications/send`, which still resolves recipients through the caller’s own client.

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

---

## Fix as implemented

**Branch:** `fix/007-push-delivery-audience`
**PR:** see branch
**Migration:** `supabase/migrations/20260918000000_chat_notification_jobs.sql`

**Decisions taken, 2026-09-17 (user):** chat joins the job queue BUG-006 built; the D2 preference migration
ships here, with an inventory run first; per-device opt-out is filed separately as
[BUG-022](../022-no-per-device-push-opt-out.md).

### The root cause

Recipient resolution now runs as the service role in one place,
`apps/web/src/lib/notifications/recipients.ts`, and is centred on **the adult who receives** rather than on
the roster:

- a member with their own login is their own recipient
- a managed player resolves to their guardians, who may have no roster row at all
- an adult covering two children on the team is resolved once
- each adult's **own** preferences decide (D2), superseding the archived rule where a managed child's row
  spoke for everyone managing them
- only people on the roster, or on the named list, are reached — an org director does not become a
  subscriber through administrative access

### The five gaps

| # | Gap | Fix |
| --- | --- | --- |
| 1 | Native senders never called the notification route | `apps/mobile/lib/chat-notify.ts` posts to `/api/chat/notify` with a bearer token after a message is inserted, from both the channel and DM screens. The route accepts bearer callers through `resolveRequestUser`, as the other mobile-facing routes do |
| 2 | Push queries used roster ids, missing guardians — including in the reminder cron | The shared resolver expands managed players to guardians. The reminders cron uses it too, so a guardian with no roster row now gets both the email and the push |
| 3 | Preference reads could not see other users' rows and defaulted missing ones to enabled | The resolver reads preferences as the service role; a missing row still means the documented default, but it is now the **receiving adult's** row that is read |
| 4 | Registering a device deleted the user's other Expo tokens | `registerPushToken` upserts on the token itself, so a phone and a tablet both keep working; a unique index on `expo_push_token` backs the upsert, and duplicate rows are cleaned up first |
| 5 | Send errors were swallowed, and chat shared the schedule-notification rate limit | Chat enqueues a `notification_jobs` row (`kind = 'chat'`), so it inherits per-recipient delivery records, retries and the daily sweep. Chat gets its own budget, `chatNotificationLimiter`, at 200/hour |

### Authorization, moved off RLS-by-accident

`/api/chat/notify` used to depend on what the sender's client could read. It now checks explicitly: the
message must exist, the caller must be its sender, and it must belong to the channel they name. That holds
for cookie and bearer callers alike, and it no longer needs the caller's client to see the audience.

### D2 preference migration

For each adult who manages someone, if their own row or any managed child's row had a category off, it
starts off for them. Deliberately conservative — it can silence a category for a second child whose own
setting was on, accepted by the user on 2026-09-15. **Run the inventory before merging** (see Verification).

### Retired

`/api/notifications/send` is deleted. Nothing called it after BUG-006, and it was the last code that
resolved recipients through the caller's client. `CLAUDE.md` and the mobile development notes now describe
the queue instead.

## Verification

**Tests**

| Test | Covers |
| --- | --- |
| `tests/rls/notification-recipients.test.ts` (7) | Gaps 2 and 3 against a real database: a teammate with two devices, a guardian with no roster row, the adult's own preferences winning over the child's, one notice per adult across two children, an org director excluded, the chat category never emailing, and a named list with the sender removed |
| `apps/web/tests/chat-notify-route.test.ts` (7) | Gap 1 and the authorization rules: one job addressed to everyone but the sender, bearer callers accepted, another person's message refused, a mismatched channel refused, an unauthenticated caller refused, DMs addressed to the other participant, and the chat rate limit |
| `apps/mobile/__tests__/chat-notify.test.ts` (5) | Gaps 1 and 4 on the device: the notify call's URL, token and body, silence without a session, no throw when offline, and registration upserting instead of deleting other devices |
| `apps/web/tests/notification-times.test.ts` | Retargeted from the retired route to the worker, so BUG-020's timezone guarantee still has a test on the live path |

Against the unfixed code the resolver tests cannot even run — `resolveRecipients` did not exist, and the
behavior it replaces lived inside two routes that could not see other people's tokens. The mobile
registration test fails against the old `registerPushToken`, which deleted every other Expo row first.

Full runs on a local stack reset with all migrations (pinned CLI 2.78.1): RLS **395 passed**, `apps/web`
**781 passed**, `apps/mobile` **31 passed** (4 suites — see the BUG-018 note below), `tsc --noEmit` clean for
web and mobile, eslint clean.

**BUG-018, incidentally:** the mobile suites run. That ticket is a candidate for closing — see the note
added there.

**Before merging, run the inventory** (read-only, production):

```sql
-- What the D2 migration would change
select mgr.email,
       bool_or(not coalesce(np.email_enabled, true))       as email_goes_off,
       bool_or(not coalesce(np.push_enabled, true))        as push_goes_off,
       bool_or(not coalesce(np.chat_push_enabled, true))   as chat_push_goes_off,
       bool_or(not coalesce(np.chat_digest_enabled, true)) as chat_digest_goes_off
from profiles mgr
join profile_managers pm on pm.manager_id = mgr.id and pm.manager_id <> pm.managed_id
left join notification_preferences np on np.profile_id = pm.managed_id
where mgr.auth_user_id is not null
group by mgr.email
having bool_or(not coalesce(np.email_enabled, true))
    or bool_or(not coalesce(np.push_enabled, true))
    or bool_or(not coalesce(np.chat_push_enabled, true))
    or bool_or(not coalesce(np.chat_digest_enabled, true));
```

**Before merge on staging, and after deploy in production:**

```sql
-- 1. One row per device
select indexdef from pg_indexes where indexname = 'push_subscriptions_expo_push_token_key';

-- 2. Chat jobs are being queued and sent
select kind, status, count(*) from notification_jobs group by kind, status;

-- 3. Nobody is stranded: deliveries carry reasons, not silence
select channel, status, reason, count(*)
from notification_deliveries group by channel, status, reason order by count desc;
```

Expected:
1. A unique index on `expo_push_token`.
2. `chat` rows appearing once messages are sent, with `sent` or `partial` status.
3. `skipped` rows carry `opted_out`, `no_address` or `no_subscription`; failures carry a provider message.

**After deploy, the manual checks:**
- Send a chat message from the web app: another member's phone gets the push (this is the acceptance check
  for the original finding).
- Send one from the **native** app: the same thing happens (gap 1).
- Register a second device, then send again: **both** devices buzz (gap 4).
- Have a guardian with no roster row confirm they get event reminders and chat push for their child's team
  (gap 2).
