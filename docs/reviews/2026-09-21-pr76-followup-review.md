# PR #76 — follow-up review

Reviewed `c70e660712ffa3f9a09b24e258e7c8ea871f5082`, including the fixes in `60e201e9d`.

The five original reproduction scenarios are covered by passing regression tests. The per-cell overlay, serialized writes, context clearing, and separately cached roster address those scenarios. Two related timing gaps remain; recommendation is still **request changes**.

## P2 — Recovery reads can overwrite newer authoritative data

`apps/web/src/components/availability/availability-matrix.tsx:411–420`

`revalidateCell` checks only the team/profile context before replacing the fetched cell. It does not participate in the read/write revision ordering used by ordinary page reads.

Reproduced: a write fails and starts a delayed recovery read; the user retries successfully; Refresh reads the saved Available response and retires the optimistic overlay; the old recovery read then returns its earlier empty snapshot and replaces Available with No response. The database still contains Available.

Version recovery reads against subsequent cell edits and accepted page reads. Discard a recovery result that has been superseded instead of applying it unconditionally.

## P2 — Clearing write tracking permits overlapping saves after revisiting a team

`apps/web/src/components/availability/availability-matrix.tsx:210`

`writes.current.clear()` forgets requests already sent to the server without stopping them. Returning to the same team before an old save finishes allows a new chain to write the same event/profile concurrently with that old request. Comparing the context string also cannot distinguish the first visit from the later visit.

Reproduced: start a delayed Available save on team A, visit team B, return to A, then set the cell to Maybe. The newer writes complete first; the old Available save completes last. Simulated persistence ends at Available while the UI displays Maybe.

Retain serialization for outstanding saves across context transitions (or prevent editing that cell until its outstanding save settles). Independently use a context generation and chain identity when applying callbacks so an obsolete visit cannot modify a newer visit's state or write tracking. Ignoring stale UI callbacks alone cannot prevent an already-issued write from overwriting the database.

## Validation

- Existing targeted tests: **31 passed** across matrix, window, and roster-cache suites.
- Web TypeScript validation: **passed**.
- Two additional component regression probes: **both fail**, reproducing the gaps above with controlled request timing.
- Probe source: [2026-09-21-pr76-followup-probes.tsx](./2026-09-21-pr76-followup-probes.tsx). Assertions describe desired behavior; instructions at the top explain running a temporary copy.
- No application source edits, live database race test, or full-suite rerun. Review artifacts are retained outside the test suite.
