# BUG-NNN — <one-line summary>

**Severity:** P0 | P1 | P2 | P3
**Status:** Open
**Reported:** YYYY-MM-DD by <who / what surfaced it>
**Area:** <e.g. auth, events, training, billing, notifications, ios>
**Evidence class:** Reproduced | Static | Mixed — see below
**Last verified:** <revision + environment, e.g. `bd0d68894`, local stack>

## Symptom

What the user actually sees or experiences. No diagnosis here.

## Reproduction

1. …
2. …
3. …

**Expected:** …
**Actual:** …

**Evidence class.** Label what is actually established, per part of the bug if they differ:

- **Reproduced** — observed against a running system. Name which: local stack, staging, production.
- **Static** — identified by code inspection; no execution.
- **Unverified in deployment** — the deployed behavior has not been checked, whatever local runs show.

Never write "the policy is the same in all environments" unless a deployed check established it.

## Evidence

Files with line references (`apps/web/src/...:42`), log excerpts, failing test output, probe files.

Note that the September 4 SQL/routing probes deliberately **assert the vulnerable behavior**. They are
historical evidence, not regression tests for the repaired product.

## Product decisions

Only for bugs whose fix changes a product contract. One row per question.

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| … | … | Open / the chosen answer | YYYY-MM-DD | spec or review link |

An unsettled acceptance criterion discovered at PR review is too late. Settle it here first.

## Cause

Fill in once diagnosed. Delete the section while it is still unknown rather than guessing. State plainly
which parts are diagnosed and which are inferred.

## Proposed fix

The intended approach, while the bug is open. This is a **proposal**, not a record of work done.

## Regression test

Planned coverage while the bug is open. The test must fail against the unfixed code and pass after.

Cover the legitimate path as well as the hostile one — a fix that denies an attack and also breaks normal
use is not a fix.

---

<!-- Everything below is filled in only when the bug is actually fixed, in the same PR. -->

## Fix as implemented

**Branch:** `fix/<slug>`
**PR:** #NN
**Migration:** `supabase/migrations/…` (or "none")

What changed and why that closes the cause.

## Verification

**Test:** `apps/web/tests/…` — states which test fails against the unfixed code.

**Deployment verification required:** for authorization, storage, cron and delivery changes, a merged repair
is not evidence that production received its migration or configuration. Record what must be checked after
deploy, and who checked it.
