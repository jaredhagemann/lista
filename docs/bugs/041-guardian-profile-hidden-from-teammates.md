# BUG-041 — Teammates can't read a guardian's profile, so a guardian may show as "Unknown" in chat

**Severity:** P2
**Status:** Open
**Reported:** 2026-11-02 by Claude, found while fixing [BUG-004](./fixed/004-profile-email-exposed-to-teammates.md)
**Area:** chat / rls
**Evidence class:** Mixed. The read is reproduced against the local stack. The chat display is Static, and production
hasn't been checked.
**Last verified:** `fix/004-privacy-page-contact-visibility`, local stack

## Symptom

A guardian who isn't on the team themselves sends a chat message. A coach sees their name. A player, another parent,
or a club director with no team role would see "Unknown" with no avatar.

## Reproduction

1. A guardian manages a child on a team, with no `team_members` row of their own.
2. Sign in as a player on that team, and query `profiles` for the guardian's id.

**Expected:** the row, as the policy's comment intends.
**Actual:** no row. A coach of the team gets it.

`tests/rls/profiles.test.ts` records today's behavior: "a player, another guardian and a club director don't read
the guardian's profile directly".

## Evidence

- `supabase/migrations/20260318000001_fix_profiles_select_for_profile_managers.sql`: added a branch so teammates can
  read a profile-only manager, "covers chat sender display". The branch joins `profile_managers`.
- `supabase/migrations/20260303000002_managed_profiles.sql:86`: `profile_managers` has its own RLS. Only the manager
  and `is_admin_of_profile` (a coach or manager on the child's team, by `team_members` role) can read the row. That
  applies inside the policy above, so the branch finds nothing for anyone else.
- `apps/web/src/components/chat/message-thread.tsx:39` reads `profiles!sender_id(*)`, and
  `apps/web/src/components/chat/message-item.tsx:53` shows "Unknown" without it. The mobile chat reads it the same way.
- `apps/web/src/app/dashboard/team/page.tsx:50` shows the guardian's name, relationship, email and phone to every member,
  with the service role, so hiding the name in chat protects nothing.

## Product decisions

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| What should a team's members be able to read of a guardian's profile directly? | Name and photo for chat, through a narrow function or view, not the whole row. Opening the row would also give them the guardian's date of birth and gender, which D8 doesn't clearly intend for a player's parent. | Open | | BUG-004, D8 |
| Should a club director read a guardian on their club's teams, as they read the team's members? | Yes, the same as a coach. | Open | | BUG-004 |

The privacy page says coaches and managers can see a guardian's date of birth and gender. It needs changing if the
decision changes that.

## Proposed fix

Settle the decisions first. Then give chat the sender's name and photo without opening the guardian's whole row, and
correct the policy's comment.

## Regression test

- RLS: a player on the team gets the guardian's name and photo, and not their date of birth or gender.
- RLS: a clubmate on another team and an outsider still get nothing.
- Chat: a guardian's message shows their name to a player, on the web and in the app.
