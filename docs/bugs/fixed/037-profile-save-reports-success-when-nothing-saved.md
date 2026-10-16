# BUG-037 — Profile saves report success when nothing was saved

**Severity:** P3 (see Severity note)
**Status:** Fixed
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
| Which saves does the fix cover? | All five listed in Evidence: the profile, the roster profile, both avatar updates, and the leaderboard toggle. Each one counts the rows returned | As recommended | 2026-10-16 | Product owner |
| What does a save that changed nothing say? | "Couldn't save your changes. Refresh the page and try again." The usual cause is a stale session (BUG-036) or lost access | As recommended | 2026-10-16 | Product owner |

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
**PR:** #136
**Migration:** none

- **New `apps/web/src/lib/saved.ts`:** `saveFailure(result)` returns the error message for an error. For no rows
  returned it returns `NOTHING_SAVED`, the decided message; otherwise `null`.
- **The five writes** each add `.select("id")` and pass the result to it:
  - `profile-form.tsx`: the profile and the photo
  - `roster-profile.tsx`: the profile and the photo
  - `training-leaderboard-toggle.tsx`: it keeps its own message for a real error, shows `NOTHING_SAVED` for no
    row, and reverts the switch either way
- **Found while fixing:** no `profiles` UPDATE policy covers a coach or manager editing a player they don't
  manage. The policy is own or managed only, per `20260303000002_managed_profiles.sql:108` and
  `tests/rls/profiles.test.ts:65`. The roster shows Edit to admins, though (`dashboard/team/[memberId]/page.tsx:101`).
  So those edits never saved and reported success. They now show the error. Whether admins may edit players'
  profiles is a separate product decision. Permissions are unchanged here.

## Verification

**Test:** `apps/web/tests/profile-save-nothing-saved.test.tsx`, against the real components. The update is mocked,
returning no row and no error, as PostgREST does for a refused update:
- the 5 "nothing saved" tests fail against the unfixed components: the profile form, its photo, the roster
  profile, its photo, and the leaderboard toggle, including its revert
- the 3 "saved" tests pass on both: the profile form, the roster profile and the toggle

The full web suite passes (113 files, 1,528 tests). `tsc --noEmit` is clean, and eslint has no new findings.

**Deployment verification:** none required. This is a client change with no migration.
