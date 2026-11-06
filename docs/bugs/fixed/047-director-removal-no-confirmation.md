# BUG-047 — Removing a director happens on one click, with almost no feedback

**Severity:** P2
**Status:** Fixed
**Reported:** 2026-11-06 by the product owner
**Area:** clubs
**Evidence class:** Static — see below
**Last verified:** `43de5363e` (main), code inspection only

## Symptom

In club settings, the owner selects **Remove** beside a director and the director is removed at once.
Nothing asks first, nothing says what removal does, and the only sign it worked is a brief "Director
removed" toast as the row disappears. Removing a director is a big change: they lose the club portal,
every team their directorship gave them, and any teams they own.

## Reproduction

Not run. This is what the code does:

1. As a club owner with at least one director, open **Club → Settings**.
2. Select **Remove** on a director's row.

**Expected:** a dialog says what removing them will do and asks to confirm; afterwards it's clear what
happened.
**Actual:** the removal runs immediately. A toast says "Director removed".

**Evidence class.** **Static**: read from the code, not run. Not checked in staging or production.

## Evidence

- `apps/web/src/components/club/club-settings-client.tsx:105-119` `handleRemoveDirector`: posts to
  `/api/club/directors/remove` straight away, then `toast.success("Director removed")`.
- `club-settings-client.tsx:237-245`: the **Remove** button calls it on click. There's no confirmation
  and no pending state, so the button stays live while the request runs and can be clicked again.
- What removal does, from `remove_org_director`
  (`supabase/migrations/20260924000002_club_review_fixes.sql:56-112`), in one transaction:
  - deletes the directorship, so the club portal and every club team's admin access go
  - cancels a pending ownership transfer to them
  - passes the teams they own to the owner
  - deletes their `director` rows on every club team, and with them those teams in their app
  - keeps any other role they hold on a team (coach, manager, player, parent)
  - clears their active team if it was one they can no longer reach
- `apps/web/src/app/api/club/directors/remove/route.ts` returns only `{ success: true }`, so the page
  can't say what happened, such as which teams passed to the owner.
- The comparable roster removal already confirms in a dialog (`roster-profile.tsx`, "Remove Member").

## Product decisions

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| What the confirmation dialog says | Name the director and list what changes for them: no club portal; off every team they were on as director, by count; the teams they own pass to you, by name; teams where they also coach or play, by name, which they keep. "They can be invited again later." | Specifics, as recommended | 2026-11-06 | `remove_org_director` |
| How strong the confirmation is | A red **Remove director** button and Cancel. No typing the name: re-inviting undoes it, unlike closing the club | Red button, as recommended | 2026-11-06 | |
| How success is shown | The dialog turns into a result: "Dana Director is no longer a director of SLOFC", with the teams that passed to you and the teams they're still on, and a Done button. The row is gone underneath | Result in the dialog, as recommended | 2026-11-06 | |
| Does the removed director get an email | Not in this fix; worth its own ticket | Not now | 2026-11-06 | |

## Cause

Diagnosed from the code. The settings page wired **Remove** straight to the API with a toast, as for a
low-stakes action, and the API returns nothing about what the removal did.

## Proposed fix

- **Before:** the settings page loads, for each director, the teams they own and the teams where they hold
  another role. **Remove** opens a dialog built from that.
- **Removing:** the button shows "Removing…" and is disabled, and the dialog can't be closed mid-request.
  An error stays in the dialog rather than a toast that disappears.
- **After:** `remove_org_director` returns what it did (teams passed to the owner, director places removed,
  roles kept) as `jsonb`, through a new migration. The route passes it on and the dialog shows it. That
  is what happened in the transaction, not what the page read beforehand.

## Regression test

- Fails on today's code: selecting **Remove** doesn't call the API; it opens a dialog naming the director
  and what changes. Cancel removes nothing.
- Confirming calls the API once, disables the button while it runs, and shows the result with the teams
  passed to the owner and the roles kept.
- An error is shown in the dialog, and nothing claims success.
- `remove_org_director` returns the summary, and still refuses a non-owner (RLS suite).
- Legitimate path: the owner and the signed-in user still have no **Remove**.

---

## Fix as implemented

**Branch:** `fix/047-director-removal-confirmation`
**PR:** #161
**Migration:** `supabase/migrations/20261106000000_remove_org_director_summary.sql`

- **Asking first.** **Remove** opens `RemoveDirectorDialog` (`components/club/remove-director-dialog.tsx`). It names
  the director and lists what changes: no club portal, the number of teams they're on as director, the teams they own
  passing to you by name, and the teams where they keep another role. Lines that don't apply are left out. A red
  **Remove director** button and Cancel; no typing.
- **What it reads.** The settings page loads, for the owner only, each director's director places, owned teams and
  other roles on the club's teams.
- **While removing.** The button reads "Removing…" and is disabled, Cancel is disabled, and the dialog can't be
  closed. An error appears in the dialog and the button comes back.
- **After.** `remove_org_director` now returns `teams_passed`, `director_places_removed` and `roles_kept` from its own
  transaction. Otherwise it's unchanged: it's dropped and created again because the return type changed, with the
  same grants. The route passes it on as `summary`, and the dialog shows "Director removed", "<name> is no longer a
  director of <club>.", **Passed to you** and **Still on**, with Done. The page refreshes underneath.
- Not changed: the removed director isn't emailed (decided, for its own ticket).

## Verification

**Tests, all failing against the unfixed code except where noted:**

- `apps/web/tests/club-settings-remove-director.test.tsx` (new, 7): Remove asks first with the specifics and removes
  nothing; lines that don't apply are left out; Cancel; one request with the button disabled while it runs; the
  result from the server, and Done; an error in the dialog with no success. "No Remove for the owner" passed before,
  as it covers what must stay the same.
- `apps/web/tests/club-directors-api.test.ts` (1 new): the route returns the summary.
- `tests/rls/club-directors.test.ts` (1 new): `remove_org_director` reports the team passed, one director place
  removed and the coaching role kept, and leaves out a role in another club.
- Full suites locally: web 1,796, RLS 56 files / 739. `tsc` clean, ESLint no errors.

**Browser, local stack (dev server).** A temporary director of the seed club, coaching Dev FC and owning a team of
their own, removed by the seed owner:

- Remove opened the dialog with the specifics, and nothing was removed until confirmed.
- Confirming showed "Director removed", the team passed to the owner and "Still on: Dev FC (Coach)". Done closed it
  and the row was gone.
- In the database: no directorship, the team owned by the owner, and only the coach row left.

**Not tested:** staging and production.

**Deployment verification required:** after deploy, confirm `remove_org_director` in production returns `jsonb` and
that `anon` and `authenticated` can't run it. The page reads `summary` but works without it, so a deploy that lands
before the migration shows the result without the team lists.
