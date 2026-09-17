# BUG-003 — Private chat groups are self-joinable and message bodies are mutable

**Severity:** P1
**Status:** Fixed — verified in production 2026-09-17
**Reported:** 2026-09-04 by readiness review (finding 3)
**Area:** chat / rls
**Evidence class:** Reproduced (local stack) for all defects, 2026-09-17 — **unverified in deployment**
**Last verified:** `5acde1074`, local stack, 2026-09-04

**Severity note:** an authorization bypass, but it needs the private channel's ID and team membership, so
it is P1 under the narrow P0 definition in `README.md`, not P0.

## Symptom

Three distinct defects, tracked together because they share the chat policy surface but **releasable
separately**:

1. A user can join a **private** group channel without the creator's or an admin's permission.
2. A permitted writer can alter the **body** of existing messages, not just soft-delete them.
3. DM access is not revoked when a member is removed from a team.

## Reproduction

Group admission — **reproduced** via probe:

1. As a user who is not a member of a private group channel, insert a `channel_members` row for yourself.
2. Read the channel's messages.

**Expected:** private group admission is performed by the channel's creator or an admin, per the existing
chat spec.
**Actual:** the insert succeeds and message history becomes readable.

Message mutation — **static only**, read from the UPDATE policy; not exercised by a probe.

DM revocation after removal — **static only**.

## Evidence

- Group membership policy: `supabase/migrations/20260307000000_team_chat.sql:149`
- DM policies: `supabase/migrations/20260307000000_team_chat.sql:176`
- Message UPDATE policy: `supabase/migrations/20260307000000_team_chat.sql:251`
- Message column is **`body`** (`supabase/migrations/20260307000000_team_chat.sql:46`), not `content`
- Removal cleanup: `apps/web/src/app/actions/team.ts:212`

## Product decisions

**Already decided — reference, do not reopen:**

| Existing decision | Source |
| --- | --- |
| **No message editing in v1**; group admission by creator/admin; group existence is private to members | `docs/specs/archive/team-chat.md:132`, `:240` |
| Directors do **not** automatically gain access to private groups or others' DMs | `docs/specs/multi-tenant-architecture.md:353` |
| Removal revokes all team data access, subject to another legitimate source of access | `docs/specs/archive/remove-team-member.md:25` |

The removal contract plus team-scoped DMs together support **denying** DM access once all team entitlement
is lost. Letting former members keep a historical DM view would be a deliberate exception needing its own
recorded decision. Preserving records internally is distinct from granting former members access.

| Question | Decision | Date |
| --- | --- | --- |
| Does a youth club need adult-to-child communication restrictions? | **Deferred** — who may DM whom is unchanged for now; the user is still deciding how to handle it | 2026-09-15 |

**Deferred, not declined.** DM permissions stay exactly as they are in this fix. Do not add, tighten
or relax who may message whom, and do not treat the absence of restrictions as a settled position —
it is an open question parked deliberately, to be specified on its own later.

**One exception, flagged.** Defect 3 below — DM access surviving team removal — stays in scope. It is
not a new restriction on who may DM whom; it is the existing removal contract
(`docs/specs/archive/remove-team-member.md:25`) not being applied, so a person who left the club keeps
reading DMs. If you would rather freeze all DM behavior until the policy work happens, say so and it
drops out of this ticket.

A moderation or child-communication policy must not silently broaden director access while fixing group
admission.

## Cause

The `channel_members` self-insert exception exists so a user can maintain their own read marker, but it
also applies to private groups.

The messages UPDATE policy does not restrict which columns may change, despite its soft-delete comment, so
`body` is writable — by the message's **own sender**, which is the case that matters given "no editing in
v1." DM policies identify participants without requiring current membership of the owning team, and removal
cleans channel membership but not DM access.

## Proposed fix

Separate read markers from private-group admission and align admission with the creator/admin spec rule.
Constrain mutable message fields so soft-deletion still works but arbitrary updates do not. Apply the
existing removal contract to DM access.

## Regression test

Admission: outsider joins a private group (denied); an ordinary existing member admits someone (denied per
spec); creator/admin admits (permitted); a member updates **their own** read marker (must keep working).

Mutation: **a sender editing their own message body** — this is the case that catches the flaw; testing only
another sender's message can pass while the bug remains. Also assert `sender_id`, `channel_id` and
timestamps are immutable, and that legitimate soft-deletion still succeeds.

Offboarding: DM reachability after team removal, including a removed member who retains access through
another active managed child.

**Correction, 2026-09-17.** An earlier version of this Cause said "any existing member" could admit people to a
group. The live policy did not allow that: it accepted **yourself**, the channel's creator, or a team admin. The
self branch was the hole. The admin branch contradicted the multi-tenant spec, because `is_team_admin` includes
org directors, and directors are not to be enrolled in groups without an invitation.

---

## Fix as implemented

**Branch:** `fix/003-chat-private-groups`
**PR:** #61
**Migration:** `supabase/migrations/20260917000004_chat_access_control.sql`

Mapping the live chat policies found more than the three filed defects. All are closed in one migration; no
application code changed.

| # | Defect | Fix |
| --- | --- | --- |
| 1 | **Self-admission to any channel.** `channel_members` INSERT accepted your own row for any channel, private groups included. Team admins and **org directors** could add themselves the same way. | New `can_add_channel_member`: your own row only on the team channel, or on a group you created or already belong to (the app's read-marker upsert checks the INSERT policy even when the row exists). Adding **someone else** requires being the group's creator or a team admin, and the person must be on the team. Nobody admits themselves. |
| 2 | **Re-pointing a read marker** *(found 2026-09-17)*. A member could UPDATE their own `channel_members` row's `channel_id` to a private group and join it. | Trigger `channel_members_protect_identity` locks `channel_id` and `profile_id`; `last_read_at` stays editable. |
| 3 | **Editing messages.** The UPDATE policy allowed any column change, so senders could rewrite `body`, and admins could rewrite anyone's. | Trigger `messages_protect_content` allows only soft deletion: every other column is immutable, and a deleted message cannot be restored. |
| 3b | **Moving messages** *(found 2026-09-17)*. A sender could change a message's `channel_id` to another channel they can read. Moving into one they can't read was already refused: the new row failed the SELECT policy. | Same trigger. |
| 4 | **Removal didn't revoke group or DM access.** Group messages checked group membership but not team membership. DM channels and messages checked only participation. The group creator branch of `channels` SELECT ignored the team too. | `can_access_channel` and `can_access_dm` require the caller to still be on the team (`is_team_member`, which keeps access through a managed child). `channels`, `messages` and `dm_channels` policies use them. |
| 5 | **Re-pointing a DM** *(found 2026-09-17)*. A participant could change a conversation's other participant or its team. | Trigger `dm_channels_protect_identity` locks `team_id`, `profile_a` and `profile_b`; the read markers stay editable. |

**Also repaired:** the spec'd "team admin adds a member to a group" path never worked. Policy subqueries run under
the caller's own RLS, so an admin outside a group couldn't see the group's row. The new helpers are
`SECURITY DEFINER`, so that path now works. It still has no UI.

**Helper exposure:** `profile_on_team` accepts any profile and team id, so it is revoked from client roles; it
would otherwise answer "is this person on that team?". `can_access_channel`, `can_access_dm` and
`can_add_channel_member` only ever describe the caller's own access.

**Unchanged by decision:** who may DM whom (adult-to-child policy deferred), and directors' automatic access to
**team** channels (only groups are invitation-only).

## Verification

**Tests** — `tests/rls/chat-access.test.ts`. **14 failed against the unfixed schema**:

| Test | Unfixed |
| --- | --- |
| team member adds themselves to a private group | admitted |
| team admin adds themselves to a group they weren't invited to | admitted |
| org director adds themselves to a private group | admitted |
| creator adds someone not on the team | admitted |
| team admin adds another team member | **refused**: the spec'd path was broken |
| member re-points their read marker at a private group | succeeded |
| sender edits their own message body | succeeded |
| sender moves a message into another group they belong to | succeeded |
| team admin edits someone else's message body | succeeded |
| soft-deleted message restored | succeeded |
| removed creator sees, rejoins and reads their group | all succeeded |
| removed member sees, reads and sends in their DMs | all succeeded |
| participant re-points a DM at someone else | succeeded |
| client calls `profile_on_team` | answered |

Passing before and after, preserving real app behavior:
- a member creates a group and adds themselves, a teammate, and a parent of a player (as web and mobile do)
- read-marker upserts on the team channel and on a group
- a removed parent keeps DM access through their child still on the team
- the remaining participant keeps the conversation history
- DM read markers stay editable
- every existing test in `channels.test.ts` and `messages.test.ts`, including sender and admin soft deletion

**Two tests were corrected while writing them:**
- The first DM re-point test chose which participant to replace from random ids, so the `profile_a < profile_b`
  CHECK constraint sometimes refused it instead of the policy. It now preserves the ordering.
- The first message-move test targeted a group the sender couldn't read, which Postgres already refused. It now
  targets a group they belong to, which reproduces the defect.

Full runs on a local stack reset with all migrations (pinned CLI 2.78.1):
- RLS suite: **353 passed** (previously 333)
- `apps/web` suite: **732 passed**; `tsc --noEmit` clean. No application code changed; `src/types/database.ts` regenerated, and the diff is only the four new functions
- Root tenant/billing selection: 218 passed and the 3 unchanged [BUG-017](../017-stale-test-fixtures-three-failures.md) failures

**Before merge on staging, and after deploy in production** (read-only SQL editor):

```sql
-- 1. The three identity/content triggers exist
select tgname from pg_trigger
where tgname in ('channel_members_protect_identity', 'messages_protect_content', 'dm_channels_protect_identity')
order by tgname;

-- 2. Admission goes through the helper
select with_check from pg_policies where tablename = 'channel_members' and cmd = 'INSERT';

-- 3. profile_on_team is not callable by clients
select has_function_privilege('authenticated', 'profile_on_team(uuid, uuid)', 'execute') as authenticated_can_execute;
```

Expected:
1. Three rows.
2. `can_add_channel_member(channel_id, profile_id)`.
3. `false`.

**After deploy, a quick manual check:** send a message and delete it on web; open a group and a DM on mobile.
Chat reads and read markers run through the new policies.

**Deployed and verified 2026-09-17** (merge `96a62b7fd`, PR #61):
- The staging checks passed before merge.
- The production migration job logged `Applying migration 20260917000004_chat_access_control.sql...`, and the
  Vercel production deploy succeeded.
- The production SQL checks passed (user).
- The manual chat check passed (user): sending and deleting a message on web, and opening a group and a DM on
  mobile.
