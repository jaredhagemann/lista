# BUG-045 — The progress bar ends before the page has loaded, and a team switch loads the event twice

**Severity:** P3
**Status:** Fixed
**Reported:** 2026-11-04 by the product owner, reviewing Club Overview (#157)
**Area:** navigation, dashboard
**Evidence class:** Mixed — see below
**Last verified:** this branch, production build on the local stack

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

**Found while fixing:** on the way through the event page, the placeholder goes away when the first render
redirects, and nothing replaces it until the page comes back. That's the empty gap in the table under
**Verification**.

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
- **Several placeholders in a row:** the browser timings saw at most one on the way to an event, but the bar should
  still run through several without flickering.

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
**PR:** #158
**Migration:** none

**The bar.** `PageSkeleton` now renders `ProgressWhileMounted`, which reports to `NavigationProgressContext` for as
long as it's on screen, so the bar ends when the placeholder goes. It uses a layout effect and a count held in a ref
because the URL change arrives in the same commit as the placeholder, before the reported state has updated.
`start()` no longer resets a bar that's already running.

Two faults in the bar's timers are fixed too, because the new flow would have exposed them. A second URL change just
after a finish cancelled the fade and left the bar stuck at full width, and a new start during a fade had its bar
hidden by the old timer. Pending frames and timers are now kept in one ref and cancelled by the next start or finish.

Because any placeholder now runs the bar, it also runs for placeholders no click started, such as after the back
button.

**The agenda.** An event on another team links straight to `/dashboard/switch-team`, with `prefetch={false}`, which
skips the first render. An event on the active team still links to the event.

**Not changed:**

- Other in-app links to another team's event still go through the event page, so they keep the empty gap, now with
  the bar already finished.
- The header still corrects itself after the event appears.
- The sidebar routes are still requested again after a switch.

## Verification

**Tests:** `apps/web/tests/progress-bar-placeholder.test.tsx` (new, 8 cases, 5 fail against the unfixed code),
one new case in `navigation-feedback.test.tsx`, and three new cases in `club-overview-page.test.tsx` (2 fail against
the unfixed code, and the third covers the legitimate path). The three that pass against the unfixed code cover the
legitimate paths: the bar ending when content replaces the placeholder, on a failure, and on a page with no
placeholder.

**Browser, production build on the local stack.** Median ms after clicking an event on another team, 8 clicks with no
added latency and 4 with 300 ms added to each dashboard request. The old-link columns have the new bar too, because
the direct link is what's being compared.

| | Old link | Direct link | Old link, +300 ms | Direct link, +300 ms |
| --- | --- | --- | --- | --- |
| Placeholder appears | 65 | 216 | 413 | 535 |
| Placeholder goes and the bar finishes | 369 | 537 | 713 | 841 |
| Event content appears | 633 | 537 | 1278 | 841 |
| Header shows the right team | 770 | 668 | 1712 | 1271 |

- **Bar:** it now finishes as the content appears on the direct link and on same-team clicks, and it was at rest
  afterwards on every click. Same-team content appeared at 373 ms, against 360 ms before this fix.
- **Trade-off:** the direct link has no prefetched route to show, so the placeholder appears later, and only the bar
  answers the click until then. In exchange the empty gap is gone and the content arrives sooner.
- **Prefetching:** showing the direct link and hovering over it for 3 seconds, then reloading, left the active team
  unchanged.

**Not tested:** production. Added latency is an approximation, and neither the database nor the server was remote.

**Deployment verification required:** none. No authorization, storage, cron or delivery behavior changed.
