# BUG-003 — Private chat groups are self-joinable and message bodies are mutable

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 3)
**Area:** chat / rls
**Evidence class:** Mixed — group admission Reproduced (local stack); message mutation Static
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

| Open question | Recommendation | Decision |
| --- | --- | --- |
| Does a youth club need adult-to-child communication restrictions beyond the above? | Out of scope here; raise as its own spec | **Open** |

A moderation or child-communication policy must not silently broaden director access while fixing group
admission.

## Cause

The `channel_members` self-insert exception exists so a user can maintain their own read marker, but it
also applies to private groups — and the current policy is broader than the spec in a second way: **any
existing member** can admit, where the spec says creator/admin.

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
