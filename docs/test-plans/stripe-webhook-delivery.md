# Test Plan — Stripe webhook delivery

Ticket: [BUG-015](../bugs/fixed/015-stripe-webhook-acknowledges-failed-write.md) — shipped in PR #80, merged 2026-09-23.
Review that shaped it: [PR #80 review](../reviews/2026-09-22-pr80-bug015-review.md)

**Status: not yet run.** The automated coverage is 15 cases in `tests/billing/webhook-delivery.test.ts`
plus 37 in `apps/web/tests/webhook-api.test.ts`, all against mocked Stripe. Nothing below has been
exercised against the real Stripe API, real signatures, or a real `subscriptions.retrieve` round trip.
That is the gap this plan closes.

---

## Why this needs a plan rather than a `stripe trigger`

Two things make a naive run worthless, and both are easy to walk into.

**1. `stripe trigger` fabricates its objects.** It creates a new test customer and subscription with no
relationship to any row in `organizations`. The route looks up `stripe_subscription_id`, matches nothing,
returns 200, and tells you nothing at all. A real test-mode subscription has to be linked to a real org
row first (step 3 below).

**2. Triggering twice does not test duplicate delivery.** Each `stripe trigger` creates a *different*
event, so the ledger correctly treats them as two events. Re-delivery is `stripe events resend <id>`.

**Run this locally, never against production.** Production holds live keys; test-mode events are signed
with a different secret and would be rejected, and the only way to produce a *live* event is to move real
money. The local stack uses `sk_test_` keys and is where this belongs.

---

## Setup

| # | Step | Notes |
|---|---|---|
| 0.1 | `pnpm exec supabase start` and `pnpm dev` | The route needs both |
| 0.2 | `stripe listen --forward-to localhost:3000/api/billing/webhook` | Leave it running; it prints each delivery's status code |
| 0.3 | Copy the `whsec_…` it prints into `apps/web/.env.local` as `STRIPE_WEBHOOK_SECRET`, then **restart `pnpm dev`** | The CLI's secret differs from the dashboard's. Skip this and every delivery is a 400 and the route looks broken when it is not |
| 0.4 | `stripe customers create --email verify@fixture.local` | Note the `cus_…` |
| 0.5 | `stripe subscriptions create -d "customer=cus_…" -d "items[0][price]=$STRIPE_CLUB_SMALL_PRICE_ID" -d "trial_period_days=30"` | Note the `sub_…`. A trial gives a clean `trialing` status without attaching a card |
| 0.6 | Link it to a test organization: `update organizations set stripe_subscription_id = 'sub_…', stripe_customer_id = 'cus_…' where id = '<test org>';` | **This is the step that makes the rest meaningful** |

Use a throwaway org. Do not point a fixture subscription at a real club's row.

---

## 1. Reconciliation — the behaviour this PR changed

The route no longer lets the event type decide the status. It asks Stripe what the subscription *currently*
is and writes that.

| # | Scenario | Action | Expected |
|---|---|---|---|
| 1.1 | A paid-invoice event for a trialing subscription | `stripe trigger invoice.payment_succeeded --override invoice:subscription=sub_…` | `organizations.subscription_status` = **`trialing`** — matching the Stripe dashboard, *not* `active` |
| 1.2 | Plan and limit follow the price | Same event | `plan` and `team_limit` match the subscription's price (`club_small` / 10) |
| 1.3 | Delivery acknowledged | Same event | `stripe listen` shows **200** |

**1.1 is the single most important check in this plan.** Before PR #80, `invoice.payment_succeeded` wrote
`subscription_status = 'active'` unconditionally. If you see `active` here, reconciliation is not working
and the ordering defects the review found are back.

---

## 2. Duplicate delivery — the ledger

| # | Scenario | Action | Expected |
|---|---|---|---|
| 2.1 | Find the event just delivered | `stripe events list --limit 1` | Note the `evt_…` |
| 2.2 | Deliver it a second time | `stripe events resend evt_…` | **200**, body `{"received":true,"duplicate":true}` |
| 2.3 | The ledger holds one row | `select event_id, event_type, claimed_at, completed_at from stripe_webhook_events order by received_at desc limit 5;` | Exactly **one** row for that `event_id`, with `completed_at` set |
| 2.4 | No second side effect | Watch the `pnpm dev` log during 2.2 | No second email attempt, no second organizations write |

2.4 is the point of the ledger. The writes were always value-idempotent; the *emails* were not, and a
replay used to send the owner a second one.

---

## 3. Terminal cancellation is not revived

This case was outright broken until the review round: a late paid invoice flipped a cancelled club back to
active.

| # | Scenario | Action | Expected |
|---|---|---|---|
| 3.1 | Cancel the subscription | `stripe subscriptions cancel sub_…` | The `customer.subscription.deleted` delivery returns 200; `subscription_status` = `canceled`, `plan` = `free` |
| 3.2 | A paid invoice arrives afterwards | `stripe trigger invoice.payment_succeeded --override invoice:subscription=sub_…` | **`canceled` and `free` survive.** Stripe now reports the subscription as cancelled, so that is what gets written |
| 3.3 | Subdomain quarantined, not cleared | After 3.1, if the org had a subdomain | `subdomain` value retained, `subdomain_status` = `quarantined` |

---

## 4. Signature verification still rejects

| # | Scenario | Action | Expected |
|---|---|---|---|
| 4.1 | No signature | `curl -X POST localhost:3000/api/billing/webhook -d '{}'` | `400 { "error": "missing_signature" }` |
| 4.2 | Wrong signature | Same with `-H "stripe-signature: t=1,v1=deadbeef"` | `400 { "error": "invalid_signature" }` |
| 4.3 | Neither touched the ledger | `select count(*) from stripe_webhook_events;` before and after | Unchanged. A forged request must not be able to create ledger rows |

---

## Teardown

```sql
update organizations set stripe_subscription_id = null, stripe_customer_id = null where id = '<test org>';
delete from stripe_webhook_events where event_id in ('evt_…');
```

The Stripe test-mode customer and subscription can be left; they cost nothing and are useful next time.

---

## Deliberately not covered here

- **Failure paths** — a write error returning 500, leaving no completion record, and the retry succeeding.
  Forcing these means breaking the database mid-flight, which is not worth doing to a real stack. Covered
  by the unit cases, and the ticket says so.
- **Overlapping deliveries** — the exclusive claim and the 409. Two simultaneous deliveries of one event
  cannot be arranged from the CLI with any reliability. Covered by
  `tests/billing/webhook-delivery.test.ts`.
- **The lease expiring** — five minutes of waiting to observe one boolean. Covered by a unit case that
  passes a clock.

## Known gaps in the implementation, for context

Both recorded in the ticket, neither a defect this plan should hunt for:

- Emails are sent one statement before the completion record, so a failure in that statement re-sends one
  email on retry. Closing it properly needs an outbox.
- `customer.subscription.updated` still trusts its event snapshot rather than reconciling, so two of
  *those* arriving out of order would apply the older one last.
