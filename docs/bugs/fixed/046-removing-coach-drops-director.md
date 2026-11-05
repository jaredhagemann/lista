# BUG-046 — Removing a coach who is also a club director takes the team away from them

**Severity:** P2
**Status:** Fixed
**Reported:** 2026-11-05 by the product owner, checking a corner case before doing it in production
**Area:** teams, clubs
**Evidence class:** Static — see below
**Last verified:** `cb09b4f56` (origin/main), code inspection only

## Symptom

A club director who also coaches one of the club's teams is removed from that team's roster. What should
go is the coaching role: they are still a director, so they should still see and run the team the way
they see every other team in the club. Instead the team disappears from their team switcher and roster,
they lose the team's chat, and they can't open the team in the dashboard. If it was their only active team
in the club, they can't open the club portal either.

## Reproduction

Not run. This is what the code does:

1. A club has an owner A and a director B. B is on team T with the role `coach`: either B coached T
   before becoming director (accepting the director invitation keeps a role you already hold), or B was
   invited to coach T after.
2. A opens T's roster, opens B and selects **Remove**.

**Expected:** B stays on T as `director`. Only the coaching role is gone.
**Actual:** B's only `team_members` row for T is deleted, along with B's team channel memberships and
upcoming availability for T.

**Evidence class.** **Static**: worked out by reading the code, nothing run. Not checked in staging or
production. Nobody has done this removal in production yet; this ticket comes from checking first.

## Evidence

- `supabase/migrations/20260101000000_initial_schema.sql:35`: `unique(team_id, profile_id)`. A person
  has one row per team, so a coaching director's row says `coach`, and there is no `director` row behind
  it to fall back to.
- `supabase/migrations/20260924000000_director_invitations.sql:152-164`: accepting a director
  invitation adds a `director` row to every active team `on conflict (team_id, profile_id) do nothing`.
  "A role the recipient already holds on a team is kept."
- `apps/web/src/app/actions/team.ts:130` `removeTeamMember`: deletes the target's upcoming availability
  for the team (`:206`), their `channel_members` rows for every team channel (`:215`) and pending
  invitations, then the `team_members` row (`:245`). It never checks `organization_members`.
- Access rules still allow it: `is_team_member()` and `is_team_admin()` end with
  `OR is_org_admin(team_org_id(t_id))` (`20260416000002_director_role_and_rls_helpers.sql:50,67`).
  The breakage is in the app, which finds a person's teams from `team_members` rows:
  - `apps/web/src/app/actions/team.ts:31` `setActiveTeam` and the dashboard layout
    (`apps/web/src/app/dashboard/layout.tsx:53-61`) need a membership row to make a team active.
  - `apps/web/src/lib/club/open.ts` `findClubTeam` opens a club through a team the profile is on;
    with no row on any active team it returns null.
  - `removeTeamMember` itself only lets a caller who has their own admin row on the team act
    (`team.ts:140-152`), so B can no longer remove anyone from T.
- The opposite case is already handled correctly. `remove_org_director`
  (`20260924000000_director_invitations.sql:278`) deletes only the `director` rows and keeps "any other
  role they hold". This bug is the same rule in the other direction, missing.
- The roster offers **Remove** to any admin for anyone except themselves
  (`apps/web/src/components/team/roster-profile.tsx:168`), so a plain `director` row can be removed from
  a team the same way, and the director then loses that one team (see the second decision below).

## Product decisions

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| Removing a `coach`/`manager`/`player`/`parent` who is the club's owner or a director | Change their row's role to `director` instead of deleting it | Change the role to `director` | 2026-11-05 | `20260924000000_director_invitations.sql:9` (the reverse rule) |
| Removing a row whose role is already `director` | Refuse it with a message saying directors are removed in club settings. A director's place on every team comes with the directorship | Refuse it, and hide Remove for these rows | 2026-11-05 | |
| Chat when the row becomes `director` | Keep the team-wide channel; drop private group memberships as any removal does. Directors aren't in groups unless someone adds them | Keep the team channel and private groups. Removing a director only changes their role on the team | 2026-11-05 | `docs/specs/multi-tenant-architecture.md`, `20260917000004_chat_access_control.sql:5-7` |
| Upcoming availability when the row becomes `director` | Keep it: they're still on the roster | Keep it | 2026-11-05 | |
| Team owner check (`team.ts:175`) when the row becomes `director` | Skip it for a change to `director`: a director owning a club team is normal (`create_club_team` does this) | Skip it: only the role changes | 2026-11-05 | |
| The roster's role editor can change a `director` row to coach, manager or player | Leave it: that's how a director starts coaching, and the team stays in their app | Leave it, out of scope | 2026-11-05 | |

## Cause

Diagnosed from the code. `removeTeamMember` treats "remove from the team" as "delete the membership row".
For a club owner or director, that row is the only thing that puts the team in their app. Their
directorship still gives them access through the access rules, but no screen goes through that path.

## Proposed fix

In `removeTeamMember`, look up whether the target profile is an owner or director in
`organization_members` for the team's organization. If they are, update the row to `role = 'director'`
and run only the cleanup the decisions above keep, not the delete. If the row is already `director`,
return an error. Doing the decision and the write in one SQL function would stop a director removed in
between from being left with a `director` row. Mobile calls whatever the web action calls, so check
whether it has its own removal path.

## Regression test

- Fails on today's code: an owner removes a club director who coaches T. Afterwards the director still
  has a row on T with role `director`, still belongs to T's team channel, and can make T their active
  team.
- Legitimate path: removing a coach who is not a director still deletes their row, channel memberships
  and upcoming availability exactly as before.
- Removing a `director` row from a team is refused, and the row stays.
- A director removed from the club and then removed from a team is deleted outright, not turned into a
  `director` row.

---

<!-- Everything below is filled in only when the bug is actually fixed, in the same PR. -->

## Fix as implemented

**Branch:** `fix/046-removing-coach-drops-director`
**PR:** #NN
**Migration:** `supabase/migrations/20261105000000_remove_team_member_role.sql`

**The database decides.** `remove_team_member_role(p_member_id, p_team_id)` runs as the caller, with a team admin
check, and in one transaction:

- returns `director_row` for a `director` row, changing nothing
- reads the person's owner or director membership of the team's club `FOR SHARE`, and if there is one, changes the
  row to `director` and returns `kept_as_director`
- otherwise returns `not_club_admin` (or `not_found`)

The `FOR SHARE` lock orders it against `remove_org_director`, which deletes the directorship first. If the directorship
is removed first, this finds none. If this runs first, `remove_org_director` waits, then deletes the new `director` row
with the others.

**The action.** `removeTeamMember` calls it after its own checks, before the owner check and any cleanup. For
`kept_as_director` it returns `{ success: true, keptAsDirector: true }` and touches nothing else, so chat channels,
groups, availability and invitations are left alone. It refuses `director_row` with "Directors are on every team in
the club. Remove them from the club in club settings." It returns any error rather than going on to delete. Only
`not_club_admin` continues to today's removal.

**The roster.** Remove is hidden on a `director` row. After a removal that kept the row, the toast says "<name> is a
club director, so they stay on the team as a director."

**Not changed:**

- The confirmation dialog still says the member "will lose all access to team pages", because the roster doesn't know
  who is a director.
- The access rules still let a team admin delete any `team_members` row directly, through the API rather than the app.
- A director with no row of their own on a team still can't use Remove there (`team.ts:140-152`).

## Verification

**Tests, all failing against the unfixed code except where noted:**

- `tests/rls/team-member-removal-director.test.ts` (new, 8). Covers the director's and the owner's rows becoming
  `director`, a `director` row refused and left, and a coach who isn't a club admin left for the caller to remove. It
  also covers someone removed from the club with `remove_org_director`, a directorship of another club, a missing
  row, and a caller who can't run the team refused with `42501`.
- `tests/unit/team-actions.test.ts` (4 new). A kept director has no owner check, no cleanup and no delete. A
  `director_row` is refused, and an error from the check stops the removal. Anyone else is removed as before; this
  one passed against the unfixed code, as it covers the path that must keep working.
- `apps/web/tests/roster-remove-director.test.tsx` (new, 3). Covers the toast for a kept director, Remove hidden on a
  `director` row, and the old toast for anyone else, which passed against the unfixed code.

**Browser, local stack (dev server).** A temporary user, a director of the seed club with a `coach` row on its
team, a team channel membership and an upcoming RSVP. The seed coach removed them from the roster:

- The toast said they stay on as director.
- The same row became `director`, and the channel membership and the RSVP were still there.
- Their profile then had no Remove.
- Signed in as them, the club portal opened with the header on the team as `(Director)`.

The seed team has no private groups, so keeping a group membership wasn't seen in the browser. The action doesn't
touch channels on this path; the unit test checks that no cleanup runs.

**Not tested:** staging and production.

**Deployment verification required:** the migration adds a function that changes `team_members`. After deploy,
confirm `remove_team_member_role` exists in production and that `anon` can't run it. A removal of a coaching director
in production would confirm the whole path. Not yet checked.
