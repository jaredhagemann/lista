# BUG-037 — Profile saves report success when nothing was saved

**Severity:** P3 (see Severity note)
**Status:** Open
**Reported:** 2026-10-16 by the product owner, alongside BUG-036
**Area:** profiles, web
**Evidence class:** Mixed — see below
**Last verified:** `a20cfb146` (main), by code inspection

## Symptom

Saving the profile form showed "Profile updated", but the name didn't change. A reload showed the old values.

## Reproduction

1. Get into a state where the browser's session may not update the profile shown. BUG-036 is one way: the
   session belongs to another account.
2. Change the name in **Settings → Profile** and save.

**Expected:** an error saying the change wasn't saved.
**Actual:** "Profile updated", and nothing saved.

**Evidence class.**
- **Reproduced:** the false success, by the product owner, during BUG-036.
- **Static:** the cause, and the same pattern in the other forms listed below, by code inspection.

## Evidence

- `apps/web/src/components/settings/profile-form.tsx:36-50`: `.update(...).eq("id", profile.id)` and then
  `if (error) … else toast.success("Profile updated")`.
- PostgREST returns no error when RLS lets an update match no rows. The update policy is
  `id = auth.uid() or is_managed_by_me(id)` (`20260303000002_managed_profiles.sql:108`), so an update the
  caller may not make looks exactly like a successful one.
- The same `error`-only check:
  - `profile-form.tsx:73`, the avatar URL update after an upload
  - `components/team/roster-profile.tsx:329`, a member's profile edited from the roster
  - `roster-profile.tsx:416`, its avatar
  - `components/settings/training-leaderboard-toggle.tsx:25`, the leaderboard opt-out
- The house pattern for this already exists: `.select("id")` after the update, then count the rows returned
  (the leagues dialog, TL-023).

**Severity note.** On its own, this only shows up when a write is refused, so it's cosmetic. But it hides
failures like BUG-036 and makes them look like data loss, so fix it alongside.

## Product decisions

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| Which saves does the fix cover? | All five listed in Evidence: the profile, the roster profile, both avatar updates, and the leaderboard toggle. Each one counts the rows returned | Open | | |
| What does a save that changed nothing say? | "Couldn't save your changes. Refresh the page and try again." The usual cause is a stale session (BUG-036) or lost access | Open | | |

## Cause

The profile writes treat "no error" as success. An update that RLS restricts to no rows returns no error, so a
refused save reports success.

## Proposed fix

For each listed write, add `.select("id")` to the update and treat an empty result as a failure, with the
decided message. Keep the existing error toast for real errors.

## Regression test

In `apps/web/tests/`, mocking the update to return `data: []` with no error, for the profile form and the
roster profile edit:
- the decided error shows, and "Profile updated" doesn't
- the legitimate path: a returned row still shows success and refreshes

The failure tests fail against the current forms.

---

<!-- Everything below is filled in only when the bug is actually fixed, in the same PR. -->

## Fix as implemented

**Branch:** `fix/037-profile-save-false-success`
**PR:** #NN
**Migration:** none

## Verification

**Test:** `apps/web/tests/…`
