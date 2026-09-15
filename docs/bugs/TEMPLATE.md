# BUG-NNN — <one-line summary>

**Severity:** P0 | P1 | P2 | P3
**Status:** Open
**Reported:** YYYY-MM-DD by <who / what surfaced it>
**Area:** <e.g. auth, events, training, billing, notifications, ios>

## Symptom

What the user actually sees or experiences. No diagnosis here.

## Reproduction

1. …
2. …
3. …

**Expected:** …
**Actual:** …

**Environment:** prod | staging | local | iOS <version> — include if it only reproduces in some of them.

## Evidence

Files, line references (`apps/web/src/...:42`), log excerpts, failing test output, screenshots.

## Cause

Fill in once diagnosed. Delete the section while it is still unknown rather than guessing.

## Fix

**Branch:** `fix/<slug>`
**PR:** #NN
**Migration:** `supabase/migrations/…` (or "none")

What changed and why that closes the cause.

## Regression test

**Test:** `apps/web/tests/…`

The test must fail against the unfixed code and pass after. State which, and why it covers the cause
rather than just the symptom. If a bug genuinely cannot be covered by a test, say so explicitly here.
