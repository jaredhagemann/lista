# BUG-003 — Private chat groups are self-joinable and message history is mutable

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 3)
**Area:** chat / rls

## Symptom

Two related defects in team chat:

1. A user can join a **private** group channel without the creator's permission.
2. A permitted writer can alter the **content** of existing messages, not just soft-delete them.

Additionally, DM access is not revoked when a member is removed from a team.

## Reproduction

**Reproduced** for group admission; **code-confirmed** for message mutation.

Group admission (probe):
1. As a user who is not a member of a private group channel, insert a `channel_members` row for yourself.
2. Read the channel's messages.

**Expected:** private group admission requires an invitation or an existing member's action.
**Actual:** the insert succeeds and message history becomes readable.

Message mutation is code-confirmed from the policy, not yet exercised by a probe.

## Evidence

- Group membership policy: `supabase/migrations/20260307000000_team_chat.sql:149`
- DM policies: `supabase/migrations/20260307000000_team_chat.sql:176`
- Message UPDATE policy: `supabase/migrations/20260307000000_team_chat.sql:251`
- Removal cleanup: `apps/web/src/app/actions/team.ts:212`

## Cause

The `channel_members` self-insert exception exists so a user can maintain their own read marker, but it
also applies to private groups. The messages UPDATE policy does not restrict which columns may change,
despite its soft-delete comment, so `content` is writable. DM policies identify participants without
requiring current membership of the owning team, and removal cleans channel membership but not DM access.

## Fix

Separate read markers from private-group admission, constrain mutable message fields to `deleted_at`, and
define removal/moderation/retention rules.

**Open product decision:** whether former members retain historical DMs, and what adult-to-child
communication rules a youth club requires. See "Questions" in the PR description.

## Regression test

Cover: outsider joining a private group, editing another user's message content, and DM reachability after
team removal.
