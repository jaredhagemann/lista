# Pagination scale verification (BUG-014, spec §13)

**Date:** 2026-09-22 (revised after the [PR #78 review](2026-09-22-pr78-review.md))
**Code:** `fa04fc86b` plus the stage 5 branch
**Harness:** `tests/scale/pagination-scale.test.ts`, fixture `scripts/scale-check/seed.sql`
**Environment:** local Supabase stack, PostgREST `max_rows = 1000` — the same cap as production

Run it deliberately; it is in no suite that runs on its own:

```
pnpm exec vitest run --config vitest.config.rls.mts tests/scale
```

## What was measured against

One team, sized past anything the app has today:

| | |
| --- | --- |
| Events | **100,000** (99,680 past, 320 upcoming, some cancelled, some with no cancellation flag) |
| Roster | **151** members |
| Responses | **4,500** real rows — a displayed page of ten events carries **1,500** |

Every read runs through the same repository functions the components use, **signed in as an ordinary
player**, through a `fetch` that counts every request and weighs every response. Request counts and
transferred bytes below are measured, not inferred from row counts. Service-role reads would skip the
policies, which turn out to be most of the cost.

## Results

| Read | Time | Rows | Requests | Transferred |
| --- | --- | --- | --- | --- |
| Schedule list — one page of 50 | 70 ms | 50 | **1** | 28.7 KiB |
| Calendar — the selected month | 131 ms | 102 | **1** | 25.6 KiB |
| Calendar — a neighbour, prefetched | 78 ms | 61 | **1** | 15.3 KiB |
| Availability — view ready (page + responses + roster) | 3,559 ms | 10 events / 1,500 responses | **5** | 209.3 KiB |
| …responses for a single event | 370 ms | 150 | 1 | 18.7 KiB |
| Availability — page 1 | 20 ms | 10 | **1** | 2.8 KiB |
| Availability — page 21, by cursor | 17 ms | 10 | **1** | 2.8 KiB |
| Bulk — every unanswered event in the window | 1,160 ms | — | **1** | — |

Timings are recorded, not asserted: they swing several-fold between runs on cache state alone (the
availability view-ready figure has been seen between 1.2 s and 3.6 s on the same fixture). The spec asks
for "deterministic structural goals rather than inventing a production latency SLA". The request counts,
row counts, payload sizes and plans are the assertions, and they are stable.

The five requests behind a ready availability page are exactly what the design predicts: one event page,
three response batches (1,500 rows against a 1,000-row cap plus lookahead), and one roster.

### As the history grows

The same visible page, measured at each size (spec §13):

| History | Time | Rows | Requests | Transferred |
| --- | --- | --- | --- | --- |
| 100,000 events | 70 ms | 50 | 1 | 28.7 KiB |
| 10,000 events | 50 ms | 50 | 1 | 28.7 KiB |
| 1,000 events | 221 ms | 50 | 1 | 28.6 KiB |

One request and the same payload at every size — the page does not get more expensive because the team
got older. The 1,000-event timing being the slowest of the three is measurement noise: it is taken
immediately after that fixture is re-seeded, and it is exactly why the timings are not assertions.

### The cache

The month loader holds at most six months per context, verified by walking nine and asserting
`size() <= 6`. A revisit to a cached month issues **zero** requests, asserted against the same counter
that produced the table above.

## The plan for the query that was actually sent

An earlier version of this document explained the *first* page and attributed the plan to a keyset
continuation. It now captures a real cursor from a twenty-page traversal and explains the continuation
as the repository composes it — the window's bounds, the cursor's redundant lower bound, and the keyset:

```
Limit (actual time=1.960..4.580 rows=11)
  Buffers: shared hit=841
  ->  Index Scan using events_team_start_id_idx on events (actual rows=11)
        Index Cond: ((team_id = '…') AND (start_time >= '2026-09-22 19:32:09+00')
                     AND (start_time < '2027-03-21 19:32:09+00')
                     AND (start_time >= '2027-01-01 19:31:58.087296+00'))
        Filter: (((start_time > '2027-01-01 19:31:58.087296+00')
                  OR ((start_time = '2027-01-01 19:31:58.087296+00') AND (id > '…99882')))
                 AND is_team_member(team_id))
        Rows Removed by Filter: 1
```

The cursor's timestamp is **in the index condition**, not only in the filter. Eleven rows read to return
ten, 200 events deep into the window. The test asserts that the index condition carries two
`start_time >=` bounds — the window's and the cursor's — because losing the second one changes no output
at all, only the cost, and so needs a test that looks at the plan rather than the rows.

### What the redundant bound is worth, measured

The same page with that one bound removed:

```
Limit (actual time=32.198..32.199 rows=11)
  Buffers: shared hit=4059
  ->  Sort (actual rows=11)
        Sort Key: start_time, id
        Sort Method: top-N heapsort  Memory: 26kB
        ->  Bitmap Heap Scan on events (actual rows=118)
              Recheck Cond: (… start_time > cursor …) OR (… start_time = cursor AND id > … )
              ->  BitmapOr
```

**Not what I assumed before measuring it.** The expectation — carried over from a comment written during
stage 1 — was that Postgres would scan from the window's edge and discard its way forward. It does not:
it unions two bitmap scans and sorts the result. The cost is real but it lands somewhere else, in pages
read and a sort rather than in rows filtered: **4,059 buffers against 841, 118 rows against 11, 32 ms
against 4.6 ms**. The assertion now checks for the appearance of a `Sort Method` and for the buffer
difference, which is what actually distinguishes the two plans.

## One finding, recorded and deliberately not fixed

**The response read is linear in rows, and the cost is per-row policy evaluation** — roughly 1–2.5 ms
per row depending on cache state, measured at 150 rows and at 1,500 rather than extrapolated from one.
The plan shows where it goes: for each of the 1,510 response rows, the `availability` select policy
re-derives team membership through the event —

```
Index Scan using availability_event_id_profile_id_key on availability (rows=151 loops=10)
  Filter: (EXISTS(SubPlan 1) OR EXISTS(SubPlan 3))
  Buffers: shared hit=48443
  SubPlan 1
    ->  Index Scan using events_pkey on events e (loops=1510)
          Filter: (is_team_member(team_id) AND is_team_member(team_id))
```

48,443 buffer hits to return 1,500 rows. `is_team_member` is already `STABLE`, so this is not a missing
volatility marker; Postgres simply evaluates the predicate per row.

**Not changed, on purpose.** This is a 151-member team; the app's teams are nearer 20, where the same
page is ~200 rows. Every available fix edits the `availability` select policy, which is authorization
code that every other feature depends on, and nobody is currently waiting on it. Recorded here so that
if a club-sized roster appears, the measurement and the plan are already in hand. If it becomes worth
doing, the lever is the policy, not the index: the page already filters by ten known event ids, and the
policy re-checks membership for every row underneath them.

## Release criteria still outstanding

Named rather than quietly omitted (spec §13):

- **Staging benchmark.** Not run. Everything above is local. Staging shares the schema, the cap and the
  policies, so the structural results should carry; the timings would not, and no staging numbers are
  claimed here.
- **Browser navigation tests.** Not run. Component behaviour is covered by the web suite instead
  (908 tests), which exercises the same state machines without a real browser.
- **The club member directory** is not measured here at all. It is the third query BUG-014 named and is
  tracked separately as [BUG-024](../bugs/024-club-member-directory-unpaginated.md).
- **Mobile** (spec §15) is a separate workstream with its own PR and release, and is untouched by any of
  this.
