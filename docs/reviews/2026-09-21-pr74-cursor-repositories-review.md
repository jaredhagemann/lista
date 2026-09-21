# PR #74 — cursor repositories and index review

**Recommendation: request changes before adopting these repositories in PRs 2–3.** The overall approach and index are sound, but four repository-contract issues remain.

Reviewed [PR #74](https://github.com/jaredhagemann/lista/pull/74), head `05d56740462d9b1e2f8cc2f16441b2baaf0c08a4`, against `34bfc3ce5`. No UI currently calls the new modules, so these findings concern the new foundation rather than a claim that this PR already changes deployed screens.

Scope is phase 1 only. Calendar caching, component state, bulk operations, mobile implementation, and final authenticated scale measurements remain in their agreed later phases. Application source and the migration were not changed during review.

## 1. P2 — Filter null pagination keys in SQL before applying the limit

Primary location: [availability query, lines 108–111](C:/Users/jared/Projects/lista/apps/web/src/lib/availability/queries.ts:108). Related location: [roster query](C:/Users/jared/Projects/lista/apps/web/src/lib/availability/queries.ts:149).

Responses are limited to `batchSize + 1`, then rows with null keys are removed in JavaScript, then `hasNext` is calculated from that smaller array. A null-key row can consume the lookahead slot and make the function return successfully before later valid responses are read.

**Reproduced with authenticated reads and writes:** two events ordered A then B; A has two valid responses and one null-profile response, B has one valid response. At batch size 2, the first database page contains A's three rows. Filtering leaves two, `hasNext` becomes false, and the helper returns only A's responses despite B's saved response. The current nullable schema and coach availability policy permit this fixture. The same boundary condition scales to the default batch size.

The roster helper also limits before skipping null profile IDs. With one valid member and two null-profile memberships, batch size 2 throws `Roster page ended without a usable cursor`, rather than returning the one real member. This roster fixture requires administrative/legacy setup: current membership RLS blocks the coach from creating those null memberships, but the schema allows them and the helper explicitly claims to skip them.

**Correction:** exclude null profile IDs in the database predicate before ordering, limiting, or computing lookahead in both queries. Retain full-response completion/error behavior. Test boundaries with invalid-key rows as well as ordinary complete rosters.

## 2. P2 — Validate roster batch size against the API cap

Location: [fetchTeamRoster options](C:/Users/jared/Projects/lista/apps/web/src/lib/availability/queries.ts:137).

`fetchTeamRoster` accepts an arbitrary numeric `batchSize` without the cap check present in the other repository functions. The resulting API truncation becomes a false end-of-list signal.

**Reproduced:** a team with 1,001 actual memberships, read as its authenticated coach with `{ batchSize: 1000 }`, returned exactly 1,000 members successfully. The function requested 1,001 rows, the configured API cap returned 1,000, and `hasNext` was false. A separate authorized count confirmed 1,001 memberships.

The default 500 is safe under the configured 1,000-row cap; the defect is in the explicitly exposed custom-batch option. Shared repositories should reject that unsupported request before it reaches the database.

**Correction:** use one positive-integer, supported-maximum, and lookahead-versus-cap validator for response and roster reads. The response helper currently checks only the upper-cap arithmetic and should use the same complete validation. Add zero/negative/fractional and cap-boundary regressions, including the roster path.

## 3. P2 — Reject duplicate events in a supposedly complete range

Location: [range accumulation](C:/Users/jared/Projects/lista/apps/web/src/lib/events/queries.ts:240).

The specification accepts live reads rather than cross-request snapshots, but explicitly requires an observed duplicate or non-advancing cursor inside a complete range to trigger retry/error. `fetchEventRange` appends every batch without either check.

**Reproduced against local Supabase:** four events ordered on June 1–4; after the first two rows were fetched, an authenticated coach moved the June 1 event to June 5. The range helper then returned five rows containing only four distinct IDs. The same event appears with both its old and new start time in a result labeled complete.

This differs from expecting the repository to detect every possible concurrent edit. This inconsistency is directly observable in its accumulated result and must not be passed to the calendar as valid data.

**Correction:** track seen event IDs and cursor progress during range assembly; on a duplicate/non-advancing cursor, restart the bounded read a limited number of times or raise `IncompleteRangeError`. Do not silently deduplicate and call the range complete. Retain the documented live-consistency limitations for edits the client cannot observe.

## 4. P2 — Tie return types to the selected projection

Location: [fetchEventPage generic return contract](C:/Users/jared/Projects/lista/apps/web/src/lib/events/queries.ts:140), also [fetchEventRange](C:/Users/jared/Projects/lista/apps/web/src/lib/events/queries.ts:206).

`fetchEventPage<T = EventRow>` permits the caller to choose any row shape, independently of `projection`, and casts the database response to it. Its default calendar result is consequently advertised as a complete `EventRow`, even though the calendar SELECT omits most fields. Conversely, the default list type does not describe its joined location result.

**Verified at runtime and compile time:** a calendar result's `.notes` is `undefined`, but TypeScript accepts it as `string | null`. TypeScript also accepts `fetchEventPage<{ inventedField: number }>(..., { projection: "calendar", ... })`. Compile-only assertions requiring these calls to fail produced two unused `@ts-expect-error` errors, confirming the compiler cannot protect callers.

**Correction:** define the exact calendar row type and a projection-to-row mapping, or use overloads. Derive the return type from the projection argument; do not accept an unconstrained caller-supplied result type. Apply the same relationship to range reads. Add compile-time tests for omitted calendar fields and available list location fields.

## What passed and what remains for later phases

- All **29 PR repository integration tests passed** locally: 21 event tests and 8 availability tests.
- The tests meaningfully cover stable ties, microsecond precision, cursor-row deletion, half-open bounds, combined cancellation/keyset predicates, and reads past the API cap.
- The normal web **TypeScript check passed** after the temporary compile-only probe was removed.
- All **five additional runtime probes** reproduced the findings above. They deliberately assert observed defects, not desired regression behavior.
- PR checks reported successful staging migration, unit tests, RLS integration tests, and Vercel preview at review time.
- The migration is additive and matches the selected query order. I found no blocking issue with the index definition. The additional cursor timestamp lower bound is consistent with the keyset predicate.
- I did not rerun the entire test suite, alter the database schema, reset the local stack, or verify production behavior. Local fixture helpers cleaned up the seeded data.

The owner-level index measurement is appropriately disclosed as such. Authenticated query-plan and scale checks remain a phase-5 obligation; this review does not treat them as completed. The test named “serves players and guardians the same events as the coach” currently creates a player and coach but no guardian; add a real managed-profile/guardian fixture before claiming that path is covered. A later-batch network/database-error test would also strengthen the completion contract; the current range-error test exercises the batch ceiling instead.

## Reproduction artifacts

- [Runtime probes](C:/Users/jared/Projects/lista/docs/reviews/2026-09-21-pr74-query-probes.test.ts)
- [Projection type probe](C:/Users/jared/Projects/lista/docs/reviews/2026-09-21-pr74-projection-type-probe.ts), with temporary-copy instructions in the file header

```powershell
pnpm exec vitest run --config vitest.config.rls.mts tests/rls/event-queries.test.ts tests/rls/availability-queries.test.ts
pnpm exec vitest run --config vitest.config.rls.mts docs/reviews/2026-09-21-pr74-query-probes.test.ts
```

These artifacts are review evidence and were left uncommitted. Fixing the repositories requires converting the relevant observations into tests asserting complete reads or explicit errors, rather than keeping assertions that expect the defects.
