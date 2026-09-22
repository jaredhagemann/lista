# BUG-015 — Stripe webhook returns success after a failed database write

**Severity:** P1
**Status:** Fixed
**Reported:** 2026-09-04 by readiness review (finding 15)
**Area:** billing
**Evidence class:** Static — code inspection only
**Last verified:** `fc79e3246`, 2026-09-22 — seven unchecked writes confirmed in the route before the fix

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
[BUG-005](./fixed/005-org-billing-columns-self-editable.md).

## Regression test

- a failing write does **not** acknowledge success without durably accepting retry responsibility
- duplicate delivery of one event produces one effect
- out-of-order delivery of two subscription events leaves the **newer** state in place
- signature verification still rejects an unsigned or wrongly-signed request

---

## Fix as implemented

Confirmed before changing anything: seven `.update()` calls in the route, **zero** error checks among
them, and an unconditional `{ received: true }`. The only `error` references in the file were the two
signature guards.

The invariant the fix is written to, and the tests with it, is the ticket's: **commit the processing, or
durably accept responsibility for retrying it, before acknowledging.** This route is synchronous and
accepts no such responsibility, so the only honest way to satisfy it today is to withhold the
acknowledgement. The test expresses that in one helper, `acknowledgedWithoutCommitting`, so durable
ingestion would change one function rather than every test.

**1. Every write is checked.** All of them now go through `mustWrite`, which throws on a returned error;
the route catches, logs the event type and id, and answers 500 so Stripe delivers again. Nothing can be
discarded silently without deleting that helper.

**2. A ledger, because checking errors creates the next problem.** Once the route starts returning 500,
it will be delivered the same event repeatedly — and Stripe already replays. `stripe_webhook_events`
records each event id and, separately, whether it *finished*. A completed event is acknowledged without
re-running; an event whose earlier attempt died half way runs again, which is precisely what the retry is
for. This is also what stops the billing emails going out twice, which the "every write is shaped as set
DB to the observed value" idempotency note in the route never covered — it made the writes replay-safe
and said nothing about side effects.

**3. An ordering guard, because Stripe does not promise order.** `organizations.stripe_event_at` records
the Stripe timestamp behind the current billing state, and every state write carries
`stripe_event_at.is.null,stripe_event_at.lt."<event time>"`. Expressed as a filter rather than a
read-then-write so the comparison and the write are one statement: two deliveries racing cannot both
conclude they are the newest. An older event is accepted — there is nothing to retry — but changes
nothing.

The bookkeeping lives in `lib/billing/webhook-ledger.ts` rather than in the route. Whether an event has
already been dealt with is a different question from what the event means, and separating them let the
existing handler tests keep testing handlers.

### Known gap, deliberately left

Emails are sent inside the handler, before the completion record is written. If an email succeeds and the
completion write then fails, the retry re-sends it. The window is one statement wide and the failure mode
is a duplicate email rather than lost money or wrong state; closing it properly means an outbox, which is
the same durable-ingestion work the invariant above anticipates. Recorded rather than half-built.

The ledger also grows without bound. At this app's volume that is years away, and pruning is a cron, not
a correctness fix.

## Verification

- `tests/billing/webhook-delivery.test.ts` — six cases written first and confirmed failing against the
  unfixed route: a failing write is not acknowledged; the retry then succeeds and is recorded; one event
  delivered twice has one effect and sends one email; two events out of order leave the newer state; and
  unsigned and wrongly-signed requests are still rejected without touching the ledger.
- The existing webhook suites still pass — `tests/billing/webhook.test.ts` (66) and
  `apps/web/tests/webhook-api.test.ts` (37). Their fixtures gained the `id` and `created` that every real
  Stripe event carries and these doubles had always omitted, and three assertions were tightened to
  require the ordering guard rather than tolerate it.
- Full suites: `apps/web` **910**, RLS **458**, root selection **228**, `tsc` and eslint clean.
- Not verified against live Stripe. The ticket asks explicitly not to force a failure by changing
  permissions on a real project, so the failure paths are exercised with mocked errors.
