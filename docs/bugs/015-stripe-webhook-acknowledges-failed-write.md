# BUG-015 — Stripe webhook returns success after a failed database write

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 15)
**Area:** billing
**Evidence class:** Static — code inspection only
**Last verified:** `5acde1074`, code inspection, 2026-09-04

## Symptom

Several webhook branches await a Supabase update, never inspect the returned `error`, and return
`{ received: true }`. Stripe records a successful delivery and stops retrying while Lista's subscription
state stays stale. Out-of-order events can also overwrite newer state with older.

This affects the **club's access to Lista**, not player payment collection.

## Reproduction

**Static.** Not yet run.

1. **Mock the Supabase client's returned error** for the update in `customer.subscription.updated` handling.
2. Deliver the event.

**Expected:** the handler does not acknowledge success — see the invariant below.
**Actual:** `200 { received: true }`; the club's plan never updates and Stripe never retries.

**Reproduce by mocking the returned error locally. Do not change live permissions** on a real project to
force a failure.

## Evidence

- Unchecked update: `apps/web/src/app/api/billing/webhook/route.ts:116`
- Payment status updates and success return: `apps/web/src/app/api/billing/webhook/route.ts:207`
- [Stripe webhook guidance](https://docs.stripe.com/webhooks) — documents retries, duplicate delivery and
  non-guaranteed ordering

## Cause

Return values from the Supabase writes are discarded. State is set from event snapshots with no event
ledger or ordering guard, and side effects are not universally deduplicated.

Signature verification and several lifecycle safeguards **are** implemented. That is worth preserving — but
it does not establish that the rest of the lifecycle is correct.

## Proposed fix

**The invariant is: commit the processing, or durably accept responsibility for retrying it, before
acknowledging.**

"A failing write must never return 2xx" is correct for the *current synchronous* design but too absolute as
a general rule — a durable inbox may legitimately acknowledge before downstream work completes, because it
has taken on the obligation to finish. Write the test against the invariant, not against the status code,
or it will have to be rewritten the moment durable ingestion lands.

Check every write, retry or reconcile against current provider state, and deduplicate side effects.

Protects the opposite side of billing integrity from
[BUG-005](./005-org-billing-columns-self-editable.md).

## Regression test

- a failing write does **not** acknowledge success without durably accepting retry responsibility
- duplicate delivery of one event produces one effect
- out-of-order delivery of two subscription events leaves the **newer** state in place
- signature verification still rejects an unsigned or wrongly-signed request
