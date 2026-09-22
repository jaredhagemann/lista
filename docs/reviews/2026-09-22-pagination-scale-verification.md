# Pagination scale verification (BUG-014, spec §13)

**Date:** 2026-09-22
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
player**. Service-role reads would skip the policies, which turn out to be most of the cost.

## Results

| Read | Time | Rows | Payload |
| --- | --- | --- | --- |
| Schedule list — one page of 50 | 37–44 ms | 50 | 28 KiB |
| Availability — one page of 10 events | 11–14 ms | 10 | 2.6 KiB |
| …its responses, across batches | 170–1,900 ms | 1,500 | 182 KiB |
| …the roster | 52–292 ms | 151 | 14 KiB |
| …responses for a single event | 171 ms | 150 | 18 KiB |
| Availability — page 21, by cursor | 10–17 ms | 10 | 2.6 KiB |
| Bulk — every unanswered event in the window | 67–604 ms | 1 | — |

Timings are recorded, not asserted: they swung roughly tenfold between runs depending on cache state,
and the spec asks for "deterministic structural goals rather than inventing a production latency SLA".
The assertions are structural, and they pass.

### The structural goals, and how they are held

- **List** reads one page and no history. 99,680 past events exist on this team; none of them travel.
  Asserted: every returned event starts at or after the window start.
- **Calendar** reads the selected month plus two prefetched neighbours, bounded separately.
- **Availability** reads one event page, the responses for exactly those events, and a separately cached
  roster. The 1,500 responses arrive **complete, across batches, past the 1,000-row cap** — asserted by
  count and by uniqueness of `(event_id, profile_id)`.
- **The cap itself is verified**, not assumed: a deliberate 5,000-row request comes back with exactly
  1,000. A local cap that differed from production would make the batching proof meaningless.
- **Bulk** is one request returning one number. Running it twice sets ~320 events and then **0**, because
  everything is answered and it will not overwrite.

### Deep paging is flat

Page 21 costs what page 1 costs: **10–17 ms**, same ten rows. An offset of 200 would have read 210 rows
to return 10. The plan shows why — the keyset is an index *start* condition:

```
Index Only Scan using events_team_start_id_idx on events (actual rows=10)
  Index Cond: ((team_id = '…') AND (start_time >= now()))
  Heap Fetches: 10
```

No `Sort Method` line: the index supplies the order, so nothing is gathered and sorted. `Rows Removed by
Filter` is asserted under 100 — reaching a page deep in a window must not mean reading everything in
front of it.

## One finding worth recording

**The response read is linear in rows, and the cost is per-row policy evaluation.**

| Rows | Time |
| --- | --- |
| 150 (one event) | 171 ms |
| 1,500 (ten events) | 1,720 ms |

About 1.1 ms per row, measured at both sizes rather than extrapolated from one. The plan shows where it
goes: for each of the 1,510 response rows, the `availability` select policy re-derives team membership
through the event —

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
page is ~200 rows and ~230 ms. Every available fix edits the `availability` select policy, which is
authorization code that every other feature depends on, and nobody is currently waiting on it. Recorded
here so that if a club-sized roster ever appears, the measurement and the plan are already in hand.

If it does become worth doing, the lever is the policy, not the index: the page already filters by ten
known event ids, and the policy re-checks membership for each row underneath them.

## Not covered

- No browser end-to-end run; component behaviour is covered by the web suite instead.
- Staging timings were not taken. The plans and structural goals are database- and client-shaped, and
  staging shares the schema, the cap and the policies; the numbers above would only move with hardware.
- The club member directory is not measured here. It is the third query BUG-014 named and is tracked
  separately as [BUG-024](../bugs/024-club-member-directory-unpaginated.md).
