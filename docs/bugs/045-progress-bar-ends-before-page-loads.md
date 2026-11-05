# BUG-045 — The progress bar ends before the page has loaded, and a team switch loads the event twice

**Severity:** P3
**Status:** Open
**Reported:** 2026-11-04 by the product owner, reviewing Club Overview (#157)
**Area:** navigation, dashboard
**Evidence class:** Mixed — see below
**Last verified:** `47dc11a4e`, production build on the local stack

Filed while #157 is open. The agenda and `RefreshAfterTeamSwitch` named below arrive with that PR, so the fix
branches from `main` once it is merged.

P3 because nothing is broken: every page still loads, and the grey placeholder appears straight away.

## Symptom

After clicking a link in the dashboard, the bar along the top finishes almost at once, while the page is still
loading. Clicking an event on another team has a noticeable lag before the event appears.

## Reproduction

1. Sign in as a user on more than one team in a club, and open Club Overview.
2. Click an agenda event on the active team, and watch the bar and the placeholder.
3. Click an agenda event on a different team.

**Expected:** the bar runs until the content is on screen, and a team switch takes about as long as any other
click.
**Actual:** the bar starts finishing when the placeholder appears, and a team switch takes noticeably longer.

**Evidence class.**

- **Reproduced, local stack:** the timings below.
- **Static:** the code path that ends the bar.
- **Inferred:** what the extra requests during a switch are.
- **Unverified in deployment:** nothing has been timed on production. The database was on the same machine, so
  production will be slower, by an unmeasured amount.

## Evidence

Production build (`next build`, `next start`) on the local stack. Playwright sampled the page every frame after
clicking an agenda event, 8 clicks of each kind. Median ms after the click:

| | Same team | Different team |
| --- | --- | --- |
| Bar starts | 44 | 45 |
| Placeholder appears, and the bar starts finishing | 61 | 63 |
| Event content appears | 360 | 607 |
| Header shows the right team | already correct | 729 |

The logged switch made 22 dashboard requests after the click, including one `307` from
`/dashboard/switch-team` and 4 for the event page. Most of the rest were sidebar routes, each requested twice.

- `apps/web/src/components/layout/progress-bar.tsx:76`: the bar finishes on a URL change.
- `apps/web/src/components/layout/page-skeleton.tsx`: the placeholder every dashboard `loading.tsx` renders.
- `apps/web/src/app/dashboard/schedule/[eventId]/page.tsx:69-75`: the event page redirects to the switch.
- `apps/web/src/app/dashboard/switch-team/route.ts`: sets the team and redirects back with `switched=1`.

## Product decisions

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| Should the bar run until the content is on screen? | Yes, on every dashboard page | Yes | 2026-11-05 | This ticket |
| Should the agenda link straight to the team switch? | Yes, for events on another team | Yes | 2026-11-05 | This ticket |

## Cause

**Diagnosed:**

- **The bar:** the URL changes at the same moment `loading.tsx` shows the placeholder, so the URL change ends
  the bar while the page's server data is still loading.
- **The switch:** the event page has to render far enough to find the event is on another team. It then
  redirects to the switch route, which redirects back, and the event page renders again. The first render is
  wasted. A switch took about 250 ms longer in the table above, but that time wasn't split across these steps, so
  how much of it the direct link saves is unmeasured.

**Inferred:** the repeated sidebar requests look like link prefetches running again after `router.refresh()` in
`RefreshAfterTeamSwitch`. The direct link below doesn't remove them, because the refresh is still needed.

## Proposed fix

Two parts, in this order. Only the second should shorten the wait; the first makes the wait visible.

### 1. Keep the bar running while the placeholder shows

`PageSkeleton` reports to `NavigationProgressContext` while mounted, through a small client component, using the
same mechanism `useNavigate` uses. The bar then ends when the placeholder goes away.

Points to handle:

- **No restart:** `start()` resets the bar to 0%, and the URL-change effect calls `finish()`. As written, the bar
  would finish and then restart when the placeholder reports. It should carry on from where it is.
- **No stuck bar:** the bar must end if the navigation fails or the viewer goes elsewhere, so ending it belongs in
  the effect's cleanup.
- **Pages without a placeholder:** their content arrives with the URL change, so they keep ending there.
- **Several placeholders in a row:** a switch may show the placeholder more than once on its way to the event
  (not yet checked). If so, the bar should run through them as one, without flickering.

### 2. Link straight to the switch from the agenda

For an event on a team other than the active one, the agenda links to
`/dashboard/switch-team?team=<team id>&next=/dashboard/schedule/<event id>`, skipping the wasted first render.

Points to handle:

- **Prefetching must be off for these links (`prefetch={false}`).** This route changes the viewer's active team on
  a GET, so a prefetched link could switch teams without a click, just by being on screen. Today's links are safe
  only because they point at the event page, whose prefetch stops at `loading.tsx`.
- **The header still has to update:** the route adds `switched=1`, so `RefreshAfterTeamSwitch` keeps working.
- **A stale page:** if the team was changed in another tab, a link to the event page still switches through the
  event page as it does today, so this link type stays correct.
- **Other links:** links elsewhere to another team's event, such as those in emails, keep going through the event
  page. It stays the fallback.

**Not in scope:** the header correcting itself about 120 ms after the event appears, and the repeated sidebar
requests. Look at those separately if they still stand out once this is on production.

## Regression test

Written first, failing against the unfixed code:

- **Bar:** with a placeholder mounted, the URL change doesn't end the bar. Removing the placeholder does, including
  when the navigation fails.
- **Bar, no restart:** the width isn't reset to 0% when the placeholder reports during a navigation.
- **Bar, legitimate paths:** a page with no placeholder still ends the bar on the URL change, and `useNavigate`
  still runs it (`tests/navigation-feedback.test.tsx`).
- **Agenda:** an event on another team links to the switch route with the right `team` and `next`, with prefetching
  off. An event on the active team still links straight to its event, and an unlinkable team still has no link.
- **Browser:** rerun the timing above, clicking the direct link. The team must not change until the click, and the
  header must end up on the event's team.

---

<!-- Everything below is filled in only when the bug is actually fixed, in the same PR. -->

## Fix as implemented

**Branch:** `fix/045-navigation-feedback`
**PR:** #NN
**Migration:** none

What changed and why that closes the cause.

## Verification

**Test:** `apps/web/tests/…` — states which test fails against the unfixed code.
