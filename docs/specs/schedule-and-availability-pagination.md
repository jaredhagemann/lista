# Schedule and availability pagination

**Status:** Implemented for the schedule and availability views, stages 1-5 (PRs #74, #75, #76, #77 and this one). Every default below is now settled; see the decision table.
**Date:** September 21, 2026
**Related work:** BUG-014, PR #73, BUG-010 (event timezones), BUG-009 (series edits).
**Scope:** Sections 1–14 cover the web schedule list, calendar, and availability matrix. Section 15 is a separate mobile proposal with its own PR, tests, and release.
**Baseline reviewed:** `efd98f25f46bd211f2fc9a12660251e585d72e66`.

**Delivery boundary:** Web and mobile are independent workstreams. Mobile implementation is not part of the web PR or its release criteria. Section 15 does not require porting the web UI, hooks, cache, or bulk action to mobile, and completion of the web work does not imply mobile has been fixed.

## 1. Purpose and decisions

Load data according to what the user is viewing, without silently omitting records, presenting an incomplete availability read as “No response,” or changing the scope of bulk actions according to which pages happen to be cached.

This specification supersedes the earlier BUG-014 decision to preload the entire calendar. It replaces fetch-all behavior in the three views below. The club member directory remains a separate part of BUG-014; completing this specification does not resolve that directory's review findings.

| Decision | Contract | Status |
| --- | --- | --- |
| Schedule list | Fetch one page matching its filters | Approved direction |
| Calendar | Fetch the selected month, cache recent months, and prefetch adjacent months | Approved direction |
| Availability | Fetch one page of events within a selected window and all responses for those events | Approved direction |
| Shared pagination | Deterministic ordering, cursor continuation, explicit errors | Approved direction |
| Availability on schedule edits | Preserve responses when dates, times, or venues change; existing notifications provide the opportunity to update them | Previously approved D4; unchanged |
| Event timezone | Named event timezone with team default, as specified by D5/BUG-010 | Previously approved; not replaced by this specification |
| Page navigation | Previous/Next and current page number; remove exact total pages from the critical path | **Approved** — shipped in stage 2 |
| Calendar geometry | Preserve current start-date placement and blank cells outside the selected month | **Approved** — shipped in stage 2, unchanged from before |
| Calendar display zone | Team timezone for grid boundaries and placement; when a team has none, the viewer's zone with a visible notice and a one-click fix for admins | **Approved** — amended in stage 2 after a staging report, then shipped |
| Cache policy | In-memory, six month entries per active context, 60-second freshness, refresh on focus/revisit | **Approved** — shipped in stages 2-3; measured in the [scale verification](../reviews/2026-09-22-pagination-scale-verification.md) |
| Bulk availability | All unanswered future events matching the selected window and event-type filter, including unloaded event pages | **Approved** — the event-type filter is respected, confirmed by the maintainer before stage 1; shipped in stage 4 |

The bulk alternative was “all event types within the selected window.” The maintainer chose to respect the event-type filter, and section 8 is written to that choice. Neither option ever meant “only the current page.”

## 2. Current behavior and defects being addressed

- The server schedule page fetches every event before rendering either tab. The default List tab then issues its own offset-paginated query, currently 30, 50, or 100 rows with an exact count.
- The calendar receives the entire collection and filters it in memory. It displays events on their start date and hides cancelled events. Out-of-month cells are blank.
- The availability server page fetches an entire date window, its roster, and every matching response. The matrix then slices events into pages of 10 by default, with sizes 5 through 20.
- The matrix initializes its response map once. New window props can leave saved responses appearing unanswered and make the current bulk upsert overwrite them.
- Independent Upcoming filtering in the matrix hides the events fetched by the Past window.
- Current batching has non-unique ordering, offset shifting under concurrent deletes, and request URLs containing every event ID in a window.

The [PR #73 review](../reviews/2026-09-21-bug014-pr73-review.md) records reproductions and distinguishes local evidence from production verification.

## 3. Outcomes and non-goals

### Required outcomes

1. Opening Schedule on List performs no calendar event preload.
2. Event history outside the requested page/month does not increase returned payloads or application memory for that view.
3. Static datasets have deterministic, complete traversal, including simultaneous events and responses crossing transport-page boundaries.
4. Availability displays “No response” only after the responses for that displayed event page have been loaded successfully.
5. Paging, navigation, edits, and active-profile changes cannot apply data to the wrong view or identity.
6. Bulk availability includes its full confirmed scope and never overwrites a response that already exists when the insert is attempted.
7. Ordinary queries retain caller authentication and existing row-level security (RLS).

### Non-goals

- For the web workstream: a club-wide calendar, native mobile UI changes, infinite scrolling, arbitrary jumps to numbered pages, or an export-all API. Native mobile work is proposed separately in section 15.
- A new season entity, a recurrence storage redesign, or changing existing occurrence IDs.
- Multi-day event bars or rendering an event on each day it spans.
- Offline persistence, real-time subscriptions, or a point-in-time snapshot across multiple HTTP requests.
- Increasing the API row cap or replacing it with another silent ceiling.
- Implementing all of BUG-010 as part of this pagination change. Its event-timezone contract must remain compatible.

## 4. Shared query contract

### 4.1 Separate UI pages from transport batches

| Consumer | User-visible unit | Transport behavior |
| --- | --- | --- |
| Schedule list | 30, 50, or 100 events | One event-page query with one lookahead row |
| Calendar | Selected month | Read that month's events in batches of 250 plus one lookahead until complete |
| Availability | 5–20 events, default 10 | One event-page query, followed by complete response reads restricted to those event IDs |
| Availability roster | Active team's real profile memberships | Cache a complete, correctly ordered roster; paginate transport if required |

Use a shared event-page repository function. Do not force calendar, list, roster, and responses into one callback accepting arbitrary offsets. They share mechanics but own their projection, filters, authorization context, and ordering.

Illustrative application types:

```ts
type EventCursor = { startTime: string; id: string };

type EventQuery = {
  teamId: string;
  fromInclusive?: string; // UTC instant, absent for unbounded list history
  toExclusive?: string;   // UTC instant, absent for list's open-ended future
  eventType?: "practice" | "game" | "other";
  includeCancelled: boolean;
};

type CursorPage<T, C> = {
  items: T[];
  nextCursor: C | null;
  hasNext: boolean;
};
```

Cursor state is bound to the full query identity, page size, principal/active profile, and a refresh generation. It is discarded when any of those change. A cursor is a continuation value, never an authorization token. Validate dates, UUIDs, allowed filters, and page sizes; never accept a raw database filter expression from a URL.

### 4.2 Event ordering and continuation

Order ascending by `(start_time, id)` for all event reads. After a page ending at `(t, id)`, use:

```sql
WHERE team_id = :team_id
  -- apply date/type/cancellation filters before pagination
  AND (start_time > :t OR (start_time = :t AND id > :id))
ORDER BY start_time ASC, id ASC
LIMIT :page_size_plus_one;
```

Return at most `pageSize` items. The extra row establishes `hasNext`; the cursor is the last **returned** item, not the lookahead item. Empty results return no cursor. Exactly one full page without lookahead is complete. No OFFSET is used in the new event repository.

Supabase client filters can express this predicate directly. Centralize the composite `.or(...)` construction so callers do not build their own filter strings. Preserve timestamp precision exactly as returned by the database in cursors; converting microsecond timestamps through JavaScript `Date` can truncate precision and break traversal.

All requested limits, including lookahead, must fit beneath the configured API maximum. The current verified project cap is 1,000; the largest request proposed here is 501 rows. Treat that cap as a deployment prerequisite, not an assumption that a generic helper works under every possible cap. Tests must fail if the environment cannot honor the requested limits.

### 4.3 Previous/Next behavior and counts

- Keep the starting cursor for each visited page and a bounded cache of recent page results.
- Next uses the current page's continuation cursor. Previous uses the saved starting cursor, fetching again when its rows have been evicted.
- Changing filters/page size or explicitly refreshing restarts from page 1 and clears cursor history. Mutations affecting ordering, membership in the result, or permissions do the same.
- Use “Page N,” Previous, and Next. Enable Next from `hasNext`, not from a separately counted total.
- Do not request an exact event count on every page load. Exact total pages and jump-to-page are outside the proposed initial UI. This is a deliberate change from “Page N of M,” not an accidental omission.
- Browser Back/Forward must restore logical view/filter selection. Do not claim to restore an arbitrary numbered page without its valid cursor history; restart at page 1 when that history is unavailable.

### 4.4 Consistency under writes

Keysets prevent the offset-shift omission reproduced when a previously fetched row is deleted. They do not create a database snapshot. An event moved across the cursor by another user can appear on a different page until refreshed; a response can change after it was read.

The contract is a live view with deterministic reads of unchanged keys, refreshed after local writes and when revisited/stale. It is not an audit snapshot. Never describe a sequence of independent requests as transactionally consistent. An observed duplicate ID or non-advancing cursor within a supposedly complete multi-batch read must trigger a bounded retry/error rather than silent deduplication followed by a completeness claim.

## 5. Dates and timezone contract

- Resolve an explicit grid/query timezone from the active team.

  **Amended 2026-09-21 (user), after staging.** When the team has no timezone, fall back to the
  **viewer's** zone and say so on screen, rather than to UTC. A team with no zone rendered 4:00 PM
  Pacific events — 00:00 UTC the next day — on the following day. Before this work the grid grouped by
  browser-local date, so the regression stayed invisible until a team without a zone was opened.

  The rule that stands is *never silently*: the calendar names the zone it is using, tells every member
  that reminders resolve to UTC until the team's zone is set (BUG-020's machinery), and offers coaches,
  managers and directors a one-click fix. Two viewers in different cities can still disagree about which
  day an event falls on until the team's zone is set; that is the accepted cost of the fallback, and the
  notice is what makes it visible rather than puzzling. Never depend on the **server** zone.
- Compute calendar month start and next-month start as local calendar boundaries in that zone, then convert each boundary to its UTC instant. Do not add a fixed number of hours to derive the next boundary across DST.
- Use half-open ranges: `start_time >= from` and `start_time < to`. An event exactly at the next month's midnight belongs only to that next month.
- Calendar grouping must use the same grid timezone as query boundaries. If the team grid date differs from the event-local date under D5, make the event-local date/time/zone explicit in the event presentation; do not silently move the stored instant.
- List “Upcoming” retains its existing today-onward meaning, with today calculated at midnight in the grid timezone. List “All” has no date bounds.
- Availability retains the existing windows: Upcoming `[anchor, anchor + 180 days)`, Past 30 days `[anchor - 30 days, anchor)`, and Season `[anchor - 365 days, anchor + 365 days)`. Here a day retains the existing 24-hour window duration. These are rolling windows, unlike local calendar month boundaries.
- Freeze the availability anchor for a query session. Do not recalculate it between pages or between bulk preview and confirmation. A refresh creates a new anchor and resets the cursor. Query identity includes it.
- Display actual range dates for the Season option. The current “Whole season” is not derived from a real season record; do not claim otherwise. Connecting it to actual season boundaries is separate product work.

If future calendar rendering includes neighboring dates or spans events across multiple days, derive the fetched range from the rendered grid. Multi-day overlap uses `start_time < rangeEnd AND end_time > rangeStart`, requires corresponding rendering changes and query-plan evaluation, and must not be substituted silently for this specification's start-date behavior.

## 6. Schedule views

### 6.1 Page shell and tab ownership

The server schedule page fetches identity, active membership, team configuration, and permissions only. Remove its all-events fetch and the all-events prop passed through `ScheduleView`.

Keep List as the default tab. Mount/enable its data query only while needed. Opening Calendar initiates the selected-month query; visiting List alone must not trigger adjacent-month prefetch. Keep selected month/filter state in the schedule view or a route-local provider so switching tabs does not reset the user's selection.

### 6.2 List

- Preserve event type filters, today-onward/All, page-size options, existing cancelled-event display, and existing row actions.
- Apply every filter at the database boundary before cursor pagination.
- Select the existing fields and location summary needed by the list. Avoid coupling the calendar's small projection to the list's action requirements.
- Use the shared event ordering and Previous/Next rules. An empty filtered result is distinct from failure.
- Successful duplicate/create/edit/delete/cancel/restore operations invalidate the appropriate team event caches. Refetch the list from page 1 when result membership/order may change.

### 6.3 Calendar

- Query the selected month using the start-date contract and select only calendar fields: event ID, title, type, start/end times, and cancellation state, plus event timezone when that field is implemented.
- Preserve the current behavior of hiding cancelled events. Because `is_cancelled` is nullable, treat both false and null as not cancelled; `.eq(false)` alone would change existing behavior.
- Read all batches for the selected month. Commit the month to the complete cache only once every batch succeeds. A transport page is not a user-visible event cap.
- After the foreground month completes, prefetch the previous and next month with at most one background month read active at a time. Navigation takes priority over prefetch; a prefetch failure never blocks the current month.
- Cache at most six month entries per active identity/team context using least-recently-used eviction. Cache complete empty months too. Do not start prefetch recursively from prefetched entries.
- A genuinely uncached destination shows that month's loading state. Never reuse the old month's event positions beneath the new month label. A cached destination can render immediately with an updating indicator when revalidation is needed.
- Preserve navigation and Retry on failures. Do not replace the entire Schedule page with an error caused by one month's request.

## 7. Availability matrix

### 7.1 Event and response reads

1. Resolve the active team/profile and the selected date window.
2. Fetch one event page with date and event-type predicates applied server-side, using `(start_time, id)` ordering and lookahead.
3. Fetch responses only for the **displayed** event IDs, excluding the lookahead event. There are at most 20 IDs; the request URL no longer scales with the entire season.
4. If responses exceed one transport batch, use ascending `(event_id, profile_id)` keysets with a batch size of 500 plus lookahead. Both columns form the existing unique response key for the real, non-null response rows.
5. Mark the displayed matrix page ready only after the event page, full required roster, and all response batches have succeeded.

The response query does not need a new join/RPC simply to solve the long-URL issue: the event page bounds the ID filter. Do not replace it with an IN list of every roster member or every season event.

Preserve current cancellation inclusion for availability in this pagination change; cancellation visibility is not to change implicitly because the calendar uses a different filter. Bulk operations below exclude cancelled events.

### 7.2 Roster

The matrix needs the active team's real profile memberships, not every club membership. Exclude membership rows without a profile ID. Within a team, paginate by unique `profile_id`, fetch all needed display names/roles, and sort for display only after a complete read. The current team/profile uniqueness supports this order.

Cache the roster separately from event pages, with the same identity and invalidation protections. Invalidate on roster changes and permission/profile changes. A failed roster read cannot render as an empty team. Paging or virtualizing member rows for exceptionally large teams is separate work; this design bounds the event dimension, not every possible roster size.

### 7.3 UI and state

- Window controls are the only date filter. Remove the matrix's independent Upcoming/All filter so Past and Season show the selected range without a second hidden restriction.
- Preserve the event-type selector and page sizes 5–20, default 10. Changing either resets event paging.
- Store fetched response maps under the full page query identity. Replace/reconcile them on a new successful result; do not initialize from props once and ignore later props.
- Distinguish unknown/loading cells from confirmed absent response rows. Only complete successful reads permit the label “No response.”
- Keep navigation/filter controls visible while loading or showing an error. On failed refresh, a previously complete result may remain visible only with a clear stale/error indicator; disable availability mutations until successful revalidation.
- Optimistic single-cell updates belong to an event/profile identity and mutation generation. An older fetch must not overwrite a newer optimistic result. On write failure, roll back only that mutation and revalidate; do not restore a stale whole-page map.
- Preserve existing single-cell permissions and past-event editing rules. Recompute time eligibility when actions occur; do not rely on a module-level `new Date()` fixed at import time.
- Moving between pages/windows and returning must show authoritative saved responses, including responses edited while another page was displayed.

## 8. Bulk availability across unloaded pages

### 8.1 User-visible scope

Keep bulk operations for the currently active player/profile, including an authorized guardian acting for that player. Pagination does not introduce a bulk action over other players.

Proposed scope: future, non-cancelled events in the selected window and event-type filter, for which the target profile has no response. Future is evaluated against database time when the operation executes. Existing Available, Maybe, and Unavailable responses are all protected. Past-only windows have no eligible bulk action.

The confirmation must identify the target player, chosen status, date range, event-type scope, and that events on other pages are included. Example:

> Set Alex to Available for unanswered future practices from September 21 through March 20, including events on other pages. Existing responses will not be changed.

If an eligible count is shown, obtain it from the full authorized scope rather than the loaded page. Label it as a preview; intervening responses and elapsed event times can reduce the actual inserted count. Confirm from the current selection; changing team/profile/window/type while the dialog is open closes or resets the dialog.

### 8.2 Database operation

Add a small caller-authorized database function, provisionally `set_unanswered_availability`, rather than loading every eligible event into the browser and upserting it.

Inputs: team ID, target profile ID, validated window bounds, optional allowed event type, and status. Return a compact result with the actual inserted count. Do not return every inserted response to the client.

The function must:

1. Require an authenticated caller and validate status, bounds, allowed window span, and filter values.
2. Check the target is a member of the requested team and the caller may act as that profile under the existing self/guardian rules. Do not trust the active-profile cookie as authorization or expand permissions merely because the caller coaches a team.
3. Retain existing RLS by using caller privileges (`SECURITY INVOKER`), a controlled search path, and grants limited to intended authenticated callers. Do not use the service role.
4. Select eligible events on the server by team, confirmed scope, database current time, and non-cancelled status (including null-as-not-cancelled compatibility).
5. Insert missing responses in one database transaction, with `ON CONFLICT (event_id, profile_id) DO NOTHING`. Never use conflict-update for this action.
6. Return the number actually inserted; an authorization/validation/database failure rolls back the operation rather than leaving a browser loop half-complete.

The unique constraint protects a response inserted concurrently by another client: the bulk action skips that event rather than overwriting it. Event selection follows statement-time visibility; this is not a mechanism to lock the whole team's schedule. Tests must cover a response arriving between preview and confirmation and a competing insert.

After success, invalidate affected availability caches and refetch the current page. Show the actual count. A timeout has an uncertain outcome: revalidate before offering a user-initiated retry, and do not announce that zero changes occurred. Conflict-ignore makes unchanged-scope retries non-overwriting, but a retry is a new operation and may include newly eligible rows; do not claim exactly-once semantics.

This write RPC is an intentional addition beyond the ordinary client read queries. It changes no event/response data model and is needed to preserve full-window behavior safely after the browser stops loading the whole window.

## 9. Cache ownership, refresh, and errors

Use a small route-scoped query/cache module or an existing established query library if the project adopts one before implementation. Do not add a library solely to avoid specifying behavior. Keep the query repository separate from React hooks so it can be tested directly.

Cache keys include signed-in user, active profile, team, full normalized filter/range, timezone, projection, page size, and cursor where applicable. Cache entries are never shared between accounts or stored in persistent browser storage. Logout and identity/team switches clear relevant data immediately and abort outstanding requests. Revalidation is still needed because permission revocation can happen without a local identity change; this cache is not an authorization boundary.

Proposed freshness: 60 seconds for complete reads, checked on revisit and window focus. Manual Refresh is always available. There is no real-time freshness promise while a view stays open indefinitely. Exact TTL/cache size are tunable; tests must assert the behavior, not hard-code incidental implementation details.

Maintain a request generation per query identity. Abort obsolete work when possible and also ignore late completions; cancellation alone is insufficient protection. A background response started before invalidation cannot repopulate the cache afterward.

| Trigger | Required invalidation |
| --- | --- |
| Event create/duplicate/edit/delete/cancel/restore, including series operations | Team calendar and list caches; availability event/response page caches affected by the team's schedule |
| Single or bulk availability write | Relevant team's availability page caches for the affected profile/events; refetch current page |
| Roster change | Team roster and availability matrix caches |
| Team timezone change | Date-boundary/grouping query identities and cursor histories; no stored instant reinterpretation |
| Account/profile/team switch or logout | Abort old-context reads, hide old data, clear corresponding caches/cursors |

Keep errors local to the requested dataset. Failed prefetch remains invisible unless that month is selected. A failed continuation prevents that range from being marked complete. Avoid a generic message telling users to narrow a range when the UI has removed the controls or the actual problem is connectivity.

Do not reuse the existing 20,000-row fetch-all ceiling as a correctness contract. If operational time/size limits are needed, they must produce an explicit recoverable error, never a successful truncated range. Record the failing query category and elapsed time/counts without logging player response contents or credentials.

## 10. Database and query-plan changes

No new event table, season table, recurrence representation, cursor table, or pagination field is required. Existing occurrence IDs, `start_time`, `end_time`, and the unique availability `(event_id, profile_id)` constraint remain the basis of reads and writes.

Add a migration for the event index:

```sql
CREATE INDEX events_team_start_id_idx
ON public.events (team_id, start_time, id);
```

Add the bulk function and any compact preview-count function if the UI displays that count; update generated database types. Check existing indexes before adding redundant ones. Verify that the existing response uniqueness index supports event/profile cursor reads and that team/profile membership reads use an appropriate index.

Use authenticated query plans and staging timings on representative data. The index is a candidate whose benefit must be measured under the actual RLS predicates, not a guarantee that policy evaluation is free. If policies or joins dominate, address the measured plan while retaining authorization semantics.

BUG-010's event timezone field is a separate, previously approved model change. This implementation must use that field when available, preserve event instants, and keep query/grid timezone logic explicit. It must not imply that pagination resolves event-local input or recurrence timezone defects.

Ordinary reads continue directly through the authenticated Supabase client. No new HTTP API route, service credential, or read RPC is required for the initial design. A future read RPC is acceptable only for a demonstrated query/consistency need and must preserve the same contract.

## 11. Implementation map and sequence

Names below describe responsibilities; exact module names can follow repository conventions.

| Existing/proposed area | Change |
| --- | --- |
| `app/dashboard/schedule/page.tsx` | Remove event preload; provide identity/team/configuration |
| `components/calendar/schedule-view.tsx` | Own selected tab/month and stable cache scope |
| `components/calendar/schedule-list.tsx` | Replace offsets/count dependency with shared cursor event reads; update footer |
| `components/calendar/schedule-calendar.tsx` | Consume month-query state; explicit timezone grouping; loading/retry states |
| `app/dashboard/availability/page.tsx` | Resolve identity/window context without fetching every event/response in the window |
| `components/availability/availability-matrix.tsx` | Server-filtered event pages, correctly refreshed response state, and full-scope bulk RPC |
| `lib/events/queries.ts` (proposed) | Validated event cursor/query repository and projections |
| `lib/availability/queries.ts` (proposed) | Bounded-ID response paging, roster loading, bulk function adapters |
| Query hooks/cache module (proposed) | Request generations, aborts, freshness, eviction, invalidation |
| `lib/availability-window.ts` | Anchored ranges and honest range labels; remove duplicate client time filtering |
| Supabase migration/types | Event index, bulk operation/optional preview, generated function types |

Suggested delivery sequence:

1. Write failing query regressions, then implement cursor repositories and index migration.
2. Convert schedule List and remove the shared preload; implement bounded Calendar loading and cache behavior in the same releasable change so Calendar is never left without data.
3. Convert availability event/response reads, roster handling, and state synchronization. Keep bulk unavailable until its full-scope replacement is ready rather than shipping a page-only interpretation.
4. Add the authorized bulk function, confirmation contract, and invalidation integrations across existing event editors and series actions.
5. Run acceptance tests and scale checks, resolve proposed product defaults, and update BUG-014's implementation/verification notes to supersede the preload decision.

No implementation or deployment is performed by this document. Do not mark BUG-014 fixed solely because the spec exists or the three views pass; its club-directory findings need separate resolution or explicit tracking.

## 12. Acceptance and regression tests

Write desired-behavior tests before implementation. The existing review probes assert defects for evidence; do not copy those assertions as the passing regression contract.

### Query correctness

- Static traversal returns every ID exactly once for 0, 1, pageSize, pageSize+1, 1,000+, and many equal-timestamp events, including microsecond timestamp differences.
- Deleting a previously returned row between requests does not skip an unchanged later event. Cursor comparison continues to work after the cursor row itself is deleted.
- Date, type, team, and cancellation predicates apply before the page limit. Invalid cursors/filter inputs fail safely; another team's cursor cannot expose its events.
- No request exceeds the configured row cap, and a lower-than-required test cap is reported as an incompatible configuration rather than accepted as proof of completeness.
- Keyset response reads return all rows for a displayed event page when there are more than 1,000 responses; no duplicates, missing members, or unbounded season-ID URL.
- Authenticated queries cover player, guardian/managed player, coach, director where applicable, outsider, and revoked access. Service-role fixture setup is not sufficient authorization coverage.

### Dates and calendar

- Events immediately before, at, and after month boundaries appear in the expected month exactly once under start-date semantics.
- DST transition months and devices in a different timezone produce the same team-calendar membership.
- A recurrence spanning months loads its stored occurrences without recreating or renumbering them.
- A month with more than 1,000 events loads completely; failure on a later batch produces a recoverable incomplete-load error.
- Navigating A → B → C while A finishes last never places A's events in C.
- Failed adjacent-month prefetch leaves the visible month usable; selecting that month presents loading/retry correctly.

### Schedule list and cache behavior

- Opening the default List tab sends only the selected list-page event read, with no all-history or calendar event query.
- Page sizes and filters work with Previous/Next and no exact-count dependency. Resets invalidate prior cursors.
- Returning to a fresh cached month avoids a foreground refetch; stale/focus refresh follows the configured policy.
- Cache size remains bounded; logout/team/profile changes cannot display or accept late data from the previous context.
- Creating, moving, cancelling, restoring, duplicating, or deleting an event and editing a series refreshes both relevant schedule views and availability. Editing outside the calendar component still invalidates its cache.

### Availability and bulk actions

- Past shows its events immediately without toggling a second filter; Season includes its historical events.
- Switching windows or event pages correctly displays a saved Unavailable response; bulk Available does not overwrite it.
- Response or roster failure never renders unloaded data as empty/no response. Controls remain usable for retry or changing the selection.
- Optimistic edits survive late older reads; failed writes roll back only their own cell mutation.
- Bulk affects eligible unloaded pages, obeys the confirmed type/window scope, excludes past/cancelled events, and never touches another player/team.
- Existing Available, Maybe, and Unavailable responses survive bulk operations, including a concurrent insert between preview and confirmation.
- An unauthorized target profile, revoked guardian relationship, invalid range/status, or non-member target fails without partial writes.
- Bulk returns actual inserted count; uncertainty on timeout triggers revalidation rather than a false failure/no-change claim.
- Date/time/venue edits preserve all existing availability under D4; this change creates no reconfirmation data.

## 13. Scale verification and release criteria

Use isolated local/staging fixtures, never real player data for load generation. Include teams with 1,000, 10,000, and 100,000 historical events while holding the visible month/page constant; include 300+ events in an availability window and more than 1,000 actual responses for a displayed page. Seed actual response rows, not only potential event/player combinations.

Record authenticated request counts, payload sizes, query plans/timings, view-ready timing, and retained cache entries. This spec sets deterministic structural goals rather than inventing a production latency SLA:

- List: one event-page query per navigation, no exact count or calendar preload on its critical path.
- Calendar: requests proportional to the selected month's event count, with separately bounded adjacent prefetch; history outside that month is not transferred.
- Availability: one event-page query plus response batches proportional to the displayed page and separately cached roster reads; no full-window response preload.
- Bulk: server-side operation returns a compact result, with no browser enumeration of the window.
- Index/query plans must demonstrate that growing unrelated history does not require fetching it into the application. Investigate scans/RLS costs before declaring the scale check passed.

Before release: targeted unit/component tests, local authenticated integration tests, relevant browser navigation tests, typecheck/lint, and staging verification with the actual API cap. Run migrations through the repository's normal PR/staging/production process; never manually push to production.

Deploy database functions/indexes before the client depends on them. Preserve existing CRUD/notification behavior. Record verification and any remaining BUG-014 work in its ticket. An application rollback can leave the additive index/function in place; do not remove schema objects while a deployed client may still call them.

## 14. References

- [BUG-014 ticket](../bugs/fixed/014-unpaginated-queries-truncate-records.md)
- [PR #73 review and reproduction evidence](../reviews/2026-09-21-bug014-pr73-review.md)
- [Recorded product decisions, including D4/D5](../reviews/2026-09-15-bug-backlog-review.md)
- [PostgreSQL guidance on unique ordering with pagination](https://www.postgresql.org/docs/current/queries-limit.html)
- [PostgreSQL multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)

---

## 15. Mobile application proposal — separate PR and release

**Status:** Proposed mobile design, added at the user's request. Mobile-specific UX and tuning defaults below are proposals, not requirements already approved through the web design.
**Delivery:** A dedicated mobile PR and an independently verified mobile release. No mobile application code belongs in the web pagination PR. Web acceptance and rollout are not gated on this section.
**Application:** Expo/React Native under `apps/mobile`.

### 15.1 Problem and independently deliverable scope

The mobile Schedule screen currently fetches every selected-team event, ordered only by start time, and separately fetches every availability row for the active profile across teams. Neither read is paginated. Results are assembled into a chronological `FlatList` with a Today divider and an automatic scroll to an upcoming event. List virtualization limits rendering work; it does not limit database reads or the in-memory collection.

The event-detail screen reads one event, all responses for that event, and the selected team's roster. Its event lookup is already bounded, but the response and roster reads are not paginated. Both screens currently interpret some unsuccessful reads as empty results or missing availability.

The mobile PR will:

1. Replace the Schedule screen's full-history query with cursor-based event loading centered on today, with separate access to older and later events.
2. Fetch the active player's availability only for the event IDs returned by each loaded schedule page.
3. Make event-detail response/roster reads complete or explicitly failed; keep the current single-event availability actions.
4. Add mobile-specific loading, incremental retry, refresh, identity-switch, and navigation handling.
5. Preserve authorization, event IDs, existing cancellation presentation, and saved availability values.

The mobile PR will not add a month calendar, the web availability matrix, web page-size controls, bulk availability, event creation features, or an offline mutation queue. It will not redesign recurrence or implement the separate BUG-010 event-timezone work. The Home screen's five-event preview remains a preview rather than becoming a paginated schedule.

### 15.2 Proposed Schedule interaction

Use the existing chronological feed rather than web-style numbered pages.

| Interaction | Proposed mobile behavior |
| --- | --- |
| First open | Fetch the first 30 events starting at or after today's midnight in the selected team's timezone; show a Today divider and an explicit Load earlier events control |
| Later events | Load the next 30 at the lower edge through `onEndReached`, with a visible Load more/Retry fallback |
| Earlier events | Load the nearest 30 events before the history boundary when the user requests them; prepend in chronological order |
| No today/future events | Show “No upcoming events” with access to earlier events; do not say the team has no schedule |
| End of one direction | Mark only that direction exhausted; the other direction remains independently navigable |
| Pull to refresh / Today | Establish a new today anchor, invalidate old page cursors, and return to the today-centered starting view |
| Return from event detail | Preserve the feed position and reconcile the changed event/availability; do not automatically jump back to Today |

Page size 30 is a proposed implementation constant, not a new preference screen. Include events earlier today in the initial today-onward range, matching the existing Today divider's day-based meaning. Keep cancelled-event rows visibly cancelled as today; do not reuse the calendar's exclusion predicate.

Remove the effect that auto-scrolls whenever `items.length` changes. It would otherwise jump away from the user's position on every append/prepend. Initial positioning happens once per new context/explicit Today action. Prepending older events must retain the same visible event and its approximate screen offset, using stable event keys and the supported list anchoring mechanism validated on target devices. Existing content remains navigable while another page loads.

Use the team timezone explicitly for the Today partition and date grouping, with a labeled UTC fallback if configuration is missing/invalid. Freeze the boundary as a UTC instant for the pagination session; recomputing it during every request can move rows between the two directions. A foreground transition across the team's midnight refreshes that boundary. Event-local time labels must remain compatible with D5 when its timezone field is available; do not reinterpret stored event instants or silently use the device timezone to partition the feed.

### 15.3 Mobile event query contract

Implement mobile-owned query functions, provisionally in `apps/mobile/lib/schedule-queries.ts`. They use the authenticated mobile Supabase client and existing RLS. Do not import `apps/web` components, Next.js modules, browser hooks, or web cache state. Extracting a shared, platform-neutral package is optional future work and must not become a prerequisite for either release.

Each query requests `pageSize + 1` rows, uses the last returned row as its cursor, and returns `{ items, nextCursor, hasMore }`. Preserve timestamp precision in cursor values exactly as supplied by the database. Validate UUID/timestamp inputs and centralize filter construction. The configured API cap must support the largest transport request used by the mobile implementation; verify this independently at mobile release time.

**Today/later direction:** restrict to the selected team and `start_time >= frozenTodayStartUtc`; order `(start_time ASC, id ASC)`. Continuation uses:

```sql
start_time > :cursor_time
OR (start_time = :cursor_time AND id > :cursor_id)
```

**Earlier direction:** restrict to the same team and `start_time < frozenTodayStartUtc`; order `(start_time DESC, id DESC)` to fetch the closest history first. Continue toward older rows with:

```sql
start_time < :cursor_time
OR (start_time = :cursor_time AND id < :cursor_id)
```

Reverse each returned history batch for ascending display before prepending it. Derive the older continuation cursor from the oldest returned event in query order, not from the end of the reversed display array. History and today/future have independent cursor, loading, error, and exhaustion state; failures never advance either cursor.

Select the fields the existing feed uses, including the location summary. Apply any future filters before limiting and include them in query identity. Do not obtain exact full-history counts or iterate from the oldest event just to reach today. Deep links continue to fetch an event by ID, regardless of whether its schedule page has ever been loaded.

Unchanged rows must traverse deterministically, including equal start times and deletion of a previously loaded row. As with any live cursor feed, another user's event rescheduling can move a row across the boundary. Refresh reconciles the feed; this is not an immutable snapshot. Maintain one rendered row per event ID, but do not use deduplication as proof that all requested batches succeeded.

### 15.4 Availability for loaded schedule events

For every returned event page, excluding its lookahead row, fetch:

```ts
supabase
  .from("availability")
  .select("event_id, status")
  .eq("profile_id", activeProfileId)
  .in("event_id", displayedPageEventIds);
```

The existing unique event/profile constraint bounds this read to at most 30 rows for a 30-event page. The ID list is derived from the already authorized selected-team event query. Do not query all of the player's historical responses, include unrelated teams, or accumulate every previously visited event ID into one request.

Keep event loading and personal-availability loading distinguishable. Event rows may remain visible and openable if their badges fail to load, but their status must be marked loading/unavailable with a retry control. A failed or pending availability query must never display the ordinary unanswered state. Only a successful read for the exact requested IDs can establish that an absent row means no response. Skip the response request for an empty event page.

Store statuses by event/profile identity and include the active account, profile, and team in request generation/cache identity. Clear old statuses immediately on a context change, before accepting new results. A response from an old account/profile/team or a superseded refresh cannot update the current feed.

After an availability edit in event detail, invalidate/refetch that event's badge or update it from the confirmed write result and revalidate. A failed write restores only that event's prior state. Revisiting Schedule must not reset the position merely to update badges.

### 15.5 Event-detail completeness and errors

Keep the direct single-event fetch and existing single-cell availability mutation API. The mobile release does not call the web spec's new bulk function.

- Treat the event lookup as authoritative for the event's team and require authorized visibility. If a deep link is for a team other than the active context, use the existing authorized team-switch flow or show an explicit mismatch; never combine the event with the wrong team's roster.
- Page response rows for that event in a unique order, using `profile_id` for real non-null profiles within the fixed event. Page the required team roster in unique profile order as well. Use bounded transport batches, proposed 500 plus one lookahead, and caller RLS throughout.
- Fetch or derive the active player's own response only from a successful authorized read. A separate bounded event/profile lookup is acceptable so personal actions need not wait for an unusually large team response list.
- Team-wide response totals and missing-response indicators become authoritative only after both the required roster and response collections are complete. A late-batch failure must not present the loaded subset as a complete attendance view.
- Keep event information usable when the response/roster panel fails. Give each failed dataset a retry path and do not overwrite known successful data with an empty array solely because a request failed.
- Handle denied/deleted/unavailable events explicitly. Do not leave an indefinite spinner or offer actions against stale event data after a context/authorization failure.

Complete transport reads do not make arbitrarily large team rosters cheap to render. Member-list virtualization can reuse native list facilities if needed; adding a new member-search or member-pagination UX is outside this mobile release.

### 15.6 Native lifecycle, memory, and request coordination

Use mobile route/context-owned state or a mobile query cache, independent of the web cache. Invalidate by authenticated account, active profile, team, frozen date anchor, and applicable filters. Proposed freshness is 60 seconds; validate it for mobile network behavior rather than inheriting web implementation details.

- Use navigation focus and React Native application foreground events for revalidation. Coalesce these triggers so returning to the app does not issue duplicate requests.
- Protect every completion with a request generation/context check, even when aborting requests is supported. Old reads must not repopulate state after logout or a profile/team switch.
- Allow at most one continuation request per direction and coalesce repeated `onEndReached` callbacks. Do not chain through all future pages simply because the screen has not filled or a callback repeats; retain a manual Load more fallback.
- Show an inline footer/header error for a failed continuation, retaining successfully loaded events and the failed page's starting cursor for Retry. Keep initial-load failure distinct from a genuinely empty range.
- Do not start adjacent-month prefetch: mobile has no month calendar in this scope. Background fetching is driven by native feed navigation, not the web calendar policy.
- Bound retained event/status data. Proposed working set: six pages total, including the visible page; evict only from an off-screen edge and retain the boundary cursors needed to fetch it again. Do not evict the visible/anchored rows or leave an invisible gap between retained rows. An evicted edge remains loadable and is not labeled exhausted.
- Query both sides of retained boundaries as needed when revisiting evicted data; cursor comparison direction is distinct from the initial Today partition. Test cursor restoration and scroll anchoring together rather than assuming FlatList virtualization bounds JavaScript memory.
- The cache is in-memory only. App restart performs a fresh load. Offline screens may identify previously loaded data as stale; this release does not promise offline availability changes or persistent offline access.

After refreshing the Today anchor or an ordering-changing invalidation, discard incompatible cursor history. Ordinary return from detail should reconcile the relevant records without a full feed reset where possible. If a reset is necessary because an event moved or was deleted, retain a stable nearby event anchor or make the transition explicit rather than silently mixing generations.

### 15.7 Database compatibility and independent delivery

No mobile-specific table/column change, new write endpoint, or bulk RPC dependency is required. Existing versions of the app continue to use the same event/availability schema and individual availability operations.

The `(team_id, start_time, id)` event index proposed for web also supports the mobile ascending/descending scoped queries. Treat it as a shared database performance prerequisite to verify, not a web-client release dependency:

- If it is already provisioned, reference and validate that migration in the mobile PR; do not add a duplicate index.
- If mobile ships first, include or coordinate an independently deployable additive index migration in the mobile workstream through the normal database release process.
- Mobile correctness and authorization must not depend on importing the web implementation or calling its new bulk function. Database deployment and mobile binary availability do not need to coincide with the web release.
- Do not remove or change existing columns/RLS contracts to force clients to adopt pagination. Older mobile versions remain compatible, although their existing truncation defect remains until users update.
- BUG-010 timezone support is separately coordinated: consume the event timezone field if it has shipped, otherwise preserve compatibility and explicitly track the remaining event-local formatting gap. Do not make an unannounced model migration a prerequisite of this mobile pagination PR.

Web may release before or after mobile. Each PR records its own verification, deployment/version, and remaining coverage; neither closes the other's work. Do not label BUG-014 fixed across all clients merely because the web spec has shipped.

### 15.8 Mobile implementation map

| Mobile area | Proposed responsibility |
| --- | --- |
| `apps/mobile/app/(app)/schedule/index.tsx` | Today-centered feed, two query directions, scoped badges, incremental errors/retry, stable scroll |
| `apps/mobile/app/(app)/schedule/[eventId].tsx` | Complete response/roster loading, independent error states, reconciliation after individual availability writes |
| `apps/mobile/lib/schedule-queries.ts` (new, proposed) | Mobile event cursors, projections, bounded personal-response lookups |
| Mobile schedule hook/cache (new, proposed) | Context generations, native lifecycle, page working set, continuation coordination |
| `apps/mobile/contexts/AppContext.tsx` integration | Invalidate/hide old data on active team/profile/account changes without changing existing identity semantics |
| `apps/mobile/app/(app)/index.tsx` | Preserve five-event Home preview; add deterministic ID tie-breaker if touching its event ordering, not full pagination |
| `apps/mobile/__tests__` and local authenticated integration tests | Mobile-owned regressions and query/RLS coverage |

This map is independent of section 11's web implementation map. Do not modify the web source to make the mobile tests pass, and do not require a shared-package extraction in the mobile PR.

### 15.9 Mobile acceptance tests

Write tests asserting the desired behavior before implementation. Use Jest/React Native Testing Library for native component behavior and the local Supabase integration harness for real queries/RLS; do not treat web component tests as mobile verification.

1. Opening Schedule on a team with thousands of historical events fetches at most one initial event page plus lookahead and its bounded personal responses. No history traversal or all-profile response query occurs.
2. Forward and backward traversal return all static events exactly once, including equal timestamps, microsecond differences, page-boundary counts, deletion of the cursor row, and a cleared response between reads.
3. History requests fetch the nearest past events first and prepend in ascending display order. Today partitioning remains stable across device timezones and DST. A midnight foreground transition starts a fresh boundary safely.
4. No upcoming events still leaves history accessible; failure is never interpreted as no events. Exhaustion is tracked separately in each direction and not inferred from a failed fetch.
5. Repeated end-of-list notifications produce at most one request for a continuation. Prepending, appending, retrying, and response-badge refresh do not jump to Today or lose the visible anchor.
6. The six-page working set stays bounded; evicted pages can be loaded again without gaps, incorrect exhaustion, or duplicate rendered events. Memory checks include personal-response maps, not just FlatList cells.
7. Personal response queries contain only the active profile and requested page's event IDs. A player with responses in several teams never has unrelated responses downloaded for this screen.
8. A failed/pending badge query is distinguishable from unanswered; Retry recovers without clearing unrelated successful data. Late old-context results cannot alter the new profile/team's screen.
9. Event detail with more than 1,000 real response/membership rows either loads complete totals or displays an explicit failed/incomplete panel. The single-event query and own response remain correctly scoped.
10. A deep link to an unloaded event works with proper access checks. A different-team/deleted/inaccessible event does not display a mismatched roster or indefinite loading state.
11. An individual availability edit appears on return to Schedule, preserves scroll position, handles write failure, and cannot be reverted by an older in-flight fetch. Existing date/time/venue edits do not reset responses.
12. Guardian/managed-player, ordinary player, coach, and unauthorized/revoked access cases use real authenticated queries. RLS is not bypassed by tests of client convenience functions.
13. The existing mobile app remains compatible with additive database changes. The new mobile queries work without the web client changes or bulk function deployed. The Home preview remains bounded to five events.

### 15.10 Separate mobile release checklist

- Create a dedicated mobile implementation PR referencing **section 15**, with its own tests and any separately coordinated additive index migration.
- Run relevant mobile Jest tests, TypeScript checks, and local authenticated query regressions; run existing mobile regression coverage affected by context and navigation changes.
- Validate on the native platforms supported by the release, using simulator/device testing for list anchoring, navigation focus, app background/foreground, slow networks, disconnected retry, and profile/team switching. A browser preview alone is insufficient native verification.
- Stage datasets with 1,000, 10,000, and 100,000 historical events while holding the initial visible page constant. Verify bounded payload/request count and an appropriate authenticated query plan; record timings and working-set memory without inventing an unmeasured latency guarantee.
- Verify the deployed API cap, required indexes, RLS behavior, and old-client compatibility independently of the web release's checks.
- Record the mobile build/update version and the team's normal release channel. Use the project's established binary/OTA process as applicable; this spec does not assume which channel is appropriate.
- Publish independent release notes and track the mobile rollout separately. A mobile rollback does not require a web rollback; leave compatible additive indexes/functions in place while any deployed client may use them.
- Record unresolved mobile defects explicitly. Completion of section 15 does not certify unrelated mobile lists, the club directory, or all of BUG-010.
