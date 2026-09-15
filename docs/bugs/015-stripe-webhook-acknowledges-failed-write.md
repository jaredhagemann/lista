# BUG-015 — Stripe webhook returns success after a failed database write

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 15)
**Area:** billing

## Symptom

Several webhook branches await a Supabase update, never inspect the returned `error`, and return
`{ received: true }`. Stripe records a successful delivery and stops retrying while Lista's subscription
state stays stale. Out-of-order events can also overwrite newer state with older.

This affects the **club's access to Lista**, not player payment collection.

## Reproduction

**Code-confirmed.** No reproduction recorded — would need an induced database failure during webhook
handling.

1. Induce a failing Supabase update (revoked permission or constraint violation) during
   `customer.subscription.updated` handling.
2. Deliver the event.

**Expected:** a non-2xx response so Stripe retries.
**Actual:** `200 { received: true }`; the club's plan never updates and Stripe never retries.

## Evidence

- Unchecked update: `apps/web/src/app/api/billing/webhook/route.ts:116`
- Payment status updates and success return: `apps/web/src/app/api/billing/webhook/route.ts:207`
- [Stripe webhook guidance](https://docs.stripe.com/webhooks) — documents retries, duplicate delivery and
  non-guaranteed ordering

## Cause

Return values from the Supabase writes are discarded. State is set from event snapshots with no event
ledger or ordering guard, and side effects are not universally deduplicated.

Signature verification and several lifecycle safeguards **are** implemented correctly — this is narrowly
about unchecked writes and ordering.

## Fix

Durably accept events, check every write, retry or reconcile against current provider state, and deduplicate
side effects.

Related: [[005]] covers the RLS side of subscription state integrity.

## Regression test

Cover a failing write (must not 2xx), duplicate delivery of one event, and out-of-order delivery of two
subscription events.
