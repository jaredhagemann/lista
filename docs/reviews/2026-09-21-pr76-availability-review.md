# PR #76 — availability pagination review

**Recommendation: request changes.** Reviewed [PR #76](https://github.com/jaredhagemann/lista/pull/76), head `ecb5b72f2d5fa05448cfeea4f322559b1fcb50a8`, against `5d9810cbf`.

The database reads now follow the intended event-page boundary, the redundant time filter is gone, initial load failures are explicit, and bulk actions are absent as agreed for stage 3. However, concurrent edits and context changes can still display or persist the wrong availability. The separately cached roster promised for this stage is also missing.

## 1. P1 — Serialize writes to the same availability cell

Location: [cell click handler](C:/Users/jared/Projects/lista/apps/web/src/components/availability/availability-matrix.tsx:613).

The old SelfCell disabled its button while a write was pending. The replacement has no per-cell pending state and immediately fires every click's upsert/delete. Two clicks from No response issue Available then Maybe before the first request finishes. The database can process the first request last, leaving Available saved while the UI remains Maybe.

**Component reproduction:** hold the first upsert pending, click again, complete the Maybe write first, then complete the Available write. The simulated persisted value ends as Available while the displayed chip is Maybe. This demonstrates that concurrent requests are permitted and completion order can diverge from click intent; no production write race was exercised.

**Correction:** disable the affected cell until its write completes, or serialize/coalesce writes per event/profile. A client-side stale-result guard alone cannot prevent an older request from overwriting the newer database value. Keep other cells independently editable.

## 2. P2 — Scope failed-write rollback to the cell, not the whole matrix

Location: [rollback guard](C:/Users/jared/Projects/lista/apps/web/src/components/availability/availability-matrix.tsx:296).

The single `mutationGeneration` increments for every cell. Edit A, edit B, then let A fail: A's generation no longer matches, so its failed optimistic value is never rolled back. A newer edit to a different cell must not make A's failure irrelevant.

**Reproduced:** two previously unanswered events; A's request remains pending, B succeeds, then A returns an error. The toast appears, but A still displays Available even though its write failed.

**Correction:** maintain mutation versions per `(event_id, profile_id)` and query/identity context. Roll back A unless A itself has a newer edit; B's generation must not affect it. Revalidate the affected record after failure as required by the spec. Ignore callbacks belonging to an obsolete identity.

## 3. P1 — Reconcile only local mutations with fresh responses

Locations: [mergeMutations](C:/Users/jared/Projects/lista/apps/web/src/components/availability/availability-matrix.tsx:120) and [read-result reconciliation](C:/Users/jared/Projects/lista/apps/web/src/components/availability/availability-matrix.tsx:246).

There are two opposite failures in the same reconciliation contract:

1. If any edit starts during a read, `mergeMutations` copies **every** old cell over the fresh result. Reproduced: B was Available, the refreshed server result says B is Unavailable, and the user edits A while refreshing. B incorrectly stays Available because its unedited old value overwrites the server response.
2. If an edit starts **before** the read but its write is still pending, the generation captured at read start already includes that edit. The unchanged counter makes the code replace the whole map with older server data. Reproduced: click A to Available, start Refresh before the write completes, receive no response from the server, then finish the successful write. A remains displayed as No response afterward.

**Correction:** separate authoritative fetched data from an explicit per-cell pending/recent mutation overlay. Reconcile using the request's revision and each cell's write lifecycle, preserving only applicable local edits and accepting fresh values for untouched cells. A full old response map is not a mutation log. Include tests for both read-before-write and write-before-read orderings and for unrelated cells changing remotely.

## 4. P2 — Do not retain editable rows across team/profile identity changes

Location: [identity-change handling](C:/Users/jared/Projects/lista/apps/web/src/components/availability/availability-matrix.tsx:182).

The code treats a different team/profile as an ordinary refresh: it clears cursor history but retains events, roster, and response map, and the stale guard only disables editing after a read fails. Those old rows are then rendered with the **new** `currentUserId` and `isAdmin` props while the new query is pending.

**Reproduced:** load team A, rerender for team B with B's read pending, then click an existing cell. The component still sends an upsert for team A's event. A coach authorized on both teams can therefore modify the old team while the surrounding selection says B. RLS may reject some mismatches, but it does not enforce the UI's current-selection intent. If the new read fails, the old dataset remains on screen as though it were a stale result for the new context.

**Correction:** distinguish same-context revalidation from navigation to another team/profile/window/page. Retain editable data only when it belongs to the intended context. Hide/reset old identity data immediately, invalidate its requests and mutations, and keep the displayed query identity separate from the requested one. Window/page transitions must not quietly present the previous range as the newly selected one.

## 5. P2 — Implement the separately cached roster before repeated event-page reads

Location: [roster read inside every page load](C:/Users/jared/Projects/lista/apps/web/src/components/availability/availability-matrix.tsx:228).

Every event-page request calls `fetchTeamRoster` again. There is no roster cache or shared in-flight roster read. The component test moving from page 1 to page 2 records two complete roster fetches. For a large roster, each ten-event navigation repeats every roster transport batch, profile join, and associated authorization work, and waits for it before displaying responses.

This is explicitly part of the accepted stage-3 plan and spec section 7.2, rather than the bulk/cache invalidation integrations deferred to stage 4.

**Correction:** use a separately keyed complete-roster cache with freshness/manual-refresh handling and in-flight deduplication. Include team and active identity context in its key, clear it on context changes, and provide the invalidation boundary for roster changes. Cache only successful complete reads; a failed read must not become an empty roster.

## Validation and limitations

- PR tests rerun locally: **18 passed** (eight matrix tests, ten window tests).
- Normal web TypeScript check: **passed**.
- Additional controlled component probes: **six passed**, demonstrating the five findings above (two cases cover reconciliation).
- PR checks reported successful unit tests, RLS integration tests, staging migration, and Vercel preview at review time.
- Probe reads/writes use mocked repositories/Supabase responses with controlled completion ordering; they exercise the actual React component. This is not a production concurrency test or a new database/RLS audit.
- No full-suite rerun, browser end-to-end run, or scale benchmark was performed. Application source was not changed.

The [probe source](C:/Users/jared/Projects/lista/docs/reviews/2026-09-21-pr76-review-probes.tsx) is kept outside the normal test suite and includes instructions for running a temporary copy. Its assertions document defects; regression tests for the fixes should assert the desired behavior instead.

The existing tests cover one failing cell at a time and a read started before a later edit; that leaves the cross-cell and reversed timing cases above untested. Broaden those focused cases rather than relying on another successful run of the same examples.
