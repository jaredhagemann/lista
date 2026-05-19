# Club Tier Upgrade & Monetization

## Overview

Implement a self-serve upgrade flow for organizations to subscribe to Club Small or Club Large, with a 90-day free trial that requires no payment method upfront. At trial end the org is either converted to a paid Stripe subscription or downgraded to Free.

---

## Pricing Tiers

| | Free | Club Small | Club Large |
|---|---|---|---|
| Price | — | $99/month | $299/month |
| Teams | 1 | Up to 10 | Unlimited |
| Custom branding | No | Yes | Yes |
| Subdomain | No | Yes | Yes |
| Custom domain | No | No | Yes |
| Lista branding | Required | Removed | Removed |
| Trial | — | 90 days | 90 days |

---

## Database Changes

The existing `plan` column (`'free' | 'club'`) is expanded to accommodate two club tiers. No separate `tier` column is added — `plan` remains the single source of truth. The `'white_label'` value is not introduced.

```sql
-- Step 1: Add all new nullable columns first so they exist before any UPDATE references them.

-- Explicit team limit (1 = free, 10 = club_small, NULL = unlimited).
-- Must be written explicitly on every plan transition — never left implicit.
ALTER TABLE organizations ADD COLUMN team_limit integer;

-- Trial timestamp: NULL means this org has never started a trial.
-- Once set, it is NEVER cleared — it is both the expiry date and the permanent
-- "trial already consumed" signal. Whether the trial is currently active is
-- derived from subscription_status = 'trialing', not from this value.
ALTER TABLE organizations ADD COLUMN trial_ends_at timestamptz;

-- Pending plan change (Large → Small deferred downgrade via Subscription Schedule).
-- Set when the schedule is created; cleared by subscription_schedule.canceled /
-- subscription_schedule.released events (not by customer.subscription.updated,
-- which is too ambiguous to use as a schedule-cancellation signal).
-- NULL = no pending plan change.
ALTER TABLE organizations
  ADD COLUMN pending_plan text
  CHECK (pending_plan IN ('club_small'));   -- only downgrade is ever deferred
ALTER TABLE organizations ADD COLUMN pending_plan_at timestamptz;

-- Stripe Subscription Schedule ID for the pending Large → Small downgrade.
-- Stored so subscription_schedule.* events can be matched to the org without
-- relying on ambiguous customer.subscription.updated event shapes.
-- NULL when no deferred downgrade is in progress.
ALTER TABLE organizations ADD COLUMN stripe_schedule_id text;

-- Pending cancellation timestamp. Set when cancel_at_period_end = true is
-- detected on the subscription; cleared when the subscription is reactivated
-- or finally deleted. Null = not pending cancellation.
-- subscription_status stays 'active' during this window — access is unaffected.
ALTER TABLE organizations ADD COLUMN subscription_cancel_at timestamptz;

-- Trial reminder sent-at timestamps. Null = not yet sent.
-- Written immediately after a successful Resend API call.
-- Used by the reminder cron to prevent duplicate sends across reruns or missed days.
ALTER TABLE organizations ADD COLUMN trial_reminder_30d_sent_at timestamptz;
ALTER TABLE organizations ADD COLUMN trial_reminder_7d_sent_at timestamptz;
ALTER TABLE organizations ADD COLUMN trial_reminder_1d_sent_at timestamptz;

-- Step 2: Expand plan enum. Drop old constraint, backfill (team_limit now exists),
-- then add new constraint. Backfill must run while the column is unconstrained —
-- existing 'club' rows would violate the new check if added before the UPDATE.
ALTER TABLE organizations DROP CONSTRAINT organizations_plan_check;

UPDATE organizations SET plan = 'club_large', team_limit = NULL, trial_ends_at = now() WHERE plan = 'club';
UPDATE organizations SET team_limit = 1 WHERE plan = 'free';
-- Backfilling trial_ends_at for existing club orgs permanently marks them as
-- trial-ineligible. They became paying/pilot customers outside the self-serve
-- flow and must never receive a free trial if they later cancel and re-upgrade.
-- trial_ends_at IS NOT NULL is the gate in start-trial; the actual value is
-- irrelevant since subscription_status != 'trialing' so it is never displayed.

ALTER TABLE organizations
  ADD CONSTRAINT organizations_plan_check
  CHECK (plan IN ('free', 'club_small', 'club_large'));

-- Step 3: Expand subscription_status to include 'trialing'.
ALTER TABLE organizations DROP CONSTRAINT organizations_subscription_status_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_subscription_status_check
  CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled'));
```

**Backfill notes:** Backfills run between the constraint drop and re-add so the column is unconstrained during the `UPDATE`. Existing `'club'` rows (including JOGA FC) become `'club_large'` with `team_limit = NULL` and `trial_ends_at = now()`. Setting `trial_ends_at` closes the loophole where a legacy paid org cancels to Free and then claims a self-serve trial — `trial_ends_at IS NOT NULL` is the gate in `start-trial` regardless of how the value was set. Existing `'free'` rows get `team_limit = 1`.

---

## Trial Flow

### Starting a Trial

1. User (org owner) selects Club Small or Club Large from the upgrade UI.
2. No payment method is required.
3. Server sets:
   - `plan` → `'club_small'` or `'club_large'`
   - `trial_ends_at` → `now() + 90 days`
   - `subscription_status` → `'trialing'`
   - `team_limit` → `10` or `NULL`
4. User gets immediate access to all tier features.
5. No Stripe interaction at this point.

### During Trial

- A persistent banner/prompt in the club billing UI shows days remaining and a CTA to add payment method.
- Email reminders are sent by the trial-expiration cron (or a dedicated reminder cron sharing the same daily schedule). Each reminder has a corresponding sent-at column on the org row.

**Reminder schedule and idempotency:**

| Reminder | Trigger window | Sent-at column |
|---|---|---|
| 30 days left | `trial_ends_at BETWEEN now() + 29d AND now() + 31d` | `trial_reminder_30d_sent_at` |
| 7 days left | `trial_ends_at BETWEEN now() + 6d AND now() + 8d` | `trial_reminder_7d_sent_at` |
| 1 day left | `trial_ends_at BETWEEN now() + 0d AND now() + 2d` | `trial_reminder_1d_sent_at` |

For each reminder, the cron:
1. Queries orgs matching the window AND `subscription_status = 'trialing'` AND the corresponding sent-at column `IS NULL`.
2. Sends the email via Resend.
3. Immediately writes `now()` to the sent-at column after a successful API response.

Using a ±1 day window rather than an exact day ensures the reminder is still sent if the cron misses a run (e.g. infrastructure outage). The sent-at column prevents a duplicate send if the cron runs again the next day while the org is still in the window. A cron failure before the write leaves the column null, so the reminder retries on the next run — acceptable since Resend delivery is not guaranteed to be exactly once anyway.

### Adding Payment Method During Trial

User clicks "Add payment method" → `POST /api/billing/create-setup` creates a Stripe Checkout session in `mode: 'setup'` with:

```
customer: stripe_customer_id   // created first if not yet set
metadata: { org_id }
```

No `customer_update` flag is used — Stripe Checkout's `customer_update` parameter controls customer address/name fields, not the invoice default payment method.

**Webhook — `checkout.session.completed` (mode: setup):**

The existing webhook handler is extended to detect `session.mode === 'setup'`. On this event:

1. Read `session.customer`, `session.setup_intent`, and `session.metadata.org_id`.
2. Retrieve the SetupIntent: `stripe.setupIntents.retrieve(session.setup_intent)` to get the `payment_method` ID.
3. Call `stripe.customers.update(session.customer, { invoice_settings: { default_payment_method: paymentMethod } })` to make it the customer's default for future subscription invoices.
4. If `stripe_customer_id` is not yet stored on the org, write it now.

This guarantees that when the cron creates the subscription at day 91, Stripe will charge the card the user added without needing to pass an explicit `default_payment_method` to `subscriptions.create`.

**Cron source of truth:**

The cron determines whether conversion can proceed by retrieving the Stripe customer and inspecting `invoice_settings.default_payment_method`:

```
const customer = await stripe.customers.retrieve(stripe_customer_id)
const defaultPm = customer.invoice_settings.default_payment_method
```

An attached card that is not the customer's invoice default will not be charged by a new subscription — Stripe's payment method hierarchy for subscription invoices is: subscription `default_payment_method` → customer `invoice_settings.default_payment_method` → customer `default_source`. Since the subscription doesn't exist yet, only the customer default matters here. If `defaultPm` is null, treat the org as having no payment method and take the downgrade path.

The `defaultPm` ID is passed explicitly to `subscriptions.create` (see conversion path below). No separate `has_payment_method` boolean is stored in the DB.

### Trial Expiration (Day 91 Cron)

A daily cron job (`/api/cron/trial-expiration`) queries orgs where `trial_ends_at < now()` and `subscription_status = 'trialing'`. Register it in `vercel.json` alongside the existing reminders cron — same daily schedule (`0 12 * * *`) and same `CRON_SECRET` auth pattern.

**Idempotency guard:** The query already filters on `subscription_status = 'trialing'`, which is the primary guard — once the subscription is created and the webhook fires, `subscription_status` flips to `'active'` and the org is excluded from future runs. However, the webhook may arrive after the next cron run. To close this window:

1. Use a deterministic Stripe idempotency key — `trial-convert-{orgId}` — when calling `subscriptions.create`. Stripe returns the existing subscription object on duplicate calls within 24 hours, preventing double-billing.
2. Immediately after `subscriptions.create` returns, write `stripe_subscription_id` to the org row. On subsequent cron runs, skip any org where `stripe_subscription_id IS NOT NULL`, regardless of `subscription_status`. This makes the guard durable even if the webhook is delayed beyond 24 hours (after which Stripe's idempotency key expires).

**Conversion path (has payment method):**

1. Retrieve the Stripe customer and read `invoice_settings.default_payment_method` — if null, take the downgrade path instead.
2. Verify no existing active subscription in Stripe (`subscriptions.list({ customer, status: 'active' })`). If one already exists, write `stripe_subscription_id = subscription.id` and `subscription_status = 'active'` to the org row (the webhook did not sync these fields when the subscription was created via this path), then skip the remaining conversion steps. This prevents the org from remaining stuck in `trialing` in the DB and being retried on every cron run.
3. Call `subscriptions.create` with the price ID matching the org's current `plan`, the idempotency key `trial-convert-{orgId}`, and `default_payment_method` set to the ID retrieved in step 1. Passing it explicitly ensures the subscription charges the correct card regardless of any future change to the customer default.
4. Immediately write `stripe_subscription_id = subscription.id` and `subscription_status = 'active'` to the org row in a single update. The cron is the authoritative activation point for this path — `customer.subscription.created` is a no-op and must not double-write.

**Downgrade path (no payment method):**

Set `plan → 'free'`, `subscription_status → NULL`, `team_limit → 1`. `trial_ends_at` is left as-is (permanent record). `NULL` is the correct value here — there was never a Stripe subscription, so `'canceled'` would be semantically wrong. The feature gating check (`subscription_status IN ('trialing', 'active', 'past_due')`) correctly excludes `NULL`, so free orgs with no subscription history are gated out regardless of how they got there.

---

## Stripe Integration

### Products & Prices

Two Stripe products, each with a monthly recurring price:

| Product | Env var | Price |
|---|---|---|
| Club Small | `STRIPE_CLUB_SMALL_PRICE_ID` | $99/month |
| Club Large | `STRIPE_CLUB_LARGE_PRICE_ID` | $299/month |

The existing `STRIPE_CLUB_PRICE_ID` is retired: remove all code references to it as part of this feature. The env var itself can remain in place (harmless) but must be removed from `env.example` and replaced with the two new vars. JOGA FC's Stripe subscription (if any) is unaffected — the migration backfills them to `club_large` at the DB level only.

Add to `env.example`:
```
STRIPE_CLUB_SMALL_PRICE_ID=
STRIPE_CLUB_LARGE_PRICE_ID=
```

### API Routes

| Route | Purpose |
|---|---|
| `POST /api/billing/start-trial` | Starts a 90-day trial (no Stripe); body: `{ orgId, plan }` |
| `POST /api/billing/create-setup` | Creates a Stripe Checkout setup session to save a payment method; body: `{ orgId }` |
| `POST /api/billing/create-checkout` | *(existing, updated)* Creates a subscription checkout session for direct upgrades and re-upgrades after cancellation; body: `{ orgId, plan }` |
| `POST /api/billing/change-plan` | Upgrades Small → Large (immediate subscription item update) or initiates Large → Small deferred downgrade (Subscription Schedule); body: `{ orgId, plan }` |
| `POST /api/billing/cancel` | Sets `cancel_at_period_end = true` on the Stripe subscription; body: `{ orgId }` |
| `POST /api/billing/reactivate` | Clears `cancel_at_period_end` on the Stripe subscription (reverses a pending cancellation); body: `{ orgId }` |
| `POST /api/billing/portal` | *(existing)* Opens Stripe Customer Portal (payment method + history + cancel only — plan switching disabled) |
| `POST /api/billing/webhook` | *(existing, extended)* Handles Stripe events |
| `GET /api/billing/status` | *(existing, extended)* Returns plan, trial status, days remaining, pending plan change |
| `POST /api/cron/trial-expiration` | Daily cron: send trial reminders and expire trials (convert or downgrade) |
| `POST /api/admin/upgrade` | *(existing, updated)* Bypasses Stripe — manually sets an org to `club_small` or `club_large`; gated by `ADMIN_UPGRADE_CODE` env var; body: `{ orgId, plan, code }` |

### Route Authorization & State Requirements

Every billing mutation is rejected with 403 unless the caller is the org owner. Additional preconditions are enforced per route:

| Route | Caller | Current `plan` | Current `subscription_status` | Additional preconditions |
|---|---|---|---|---|
| `POST /api/billing/start-trial` | Owner | `free` | any / null | `trial_ends_at IS NULL`; `stripe_subscription_id IS NULL` |
| `POST /api/billing/create-setup` | Owner | `club_small` or `club_large` | `trialing` | — |
| `POST /api/billing/create-checkout` | Owner | `free`, or `club_*` with `canceled` | any / null | — |
| `POST /api/billing/change-plan` | Owner | `club_small` or `club_large` | `trialing` or `active` | `stripe_subscription_id IS NOT NULL` when `subscription_status = 'active'` |
| `POST /api/billing/cancel` | Owner | `club_small` or `club_large` | `active` | `stripe_subscription_id IS NOT NULL`; `subscription_cancel_at IS NULL`; `pending_plan IS NULL` |
| `POST /api/billing/reactivate` | Owner | `club_small` or `club_large` | `active` | `stripe_subscription_id IS NOT NULL`; `subscription_cancel_at IS NOT NULL` |
| `POST /api/billing/portal` | Owner | `club_small` or `club_large` | not `canceled` | `stripe_subscription_id IS NOT NULL` |
| `GET /api/billing/status` | Owner or director | any | any | — |
| `POST /api/cron/trial-expiration` | Cron (`CRON_SECRET`) | — | — | — |
| `POST /api/admin/upgrade` | Org owner | any | any | Valid `ADMIN_UPGRADE_CODE` in request body |

All mutation routes return 400 with a descriptive `error` field when a precondition is not met. Routes do not silently no-op on invalid state — they reject so the client can surface the problem rather than assuming success.

### Webhook Events

Extend the existing webhook handler to cover:

| Event | Action |
|---|---|
| `checkout.session.completed` | See below — behaviour differs by `session.mode` |
| `customer.subscription.created` | No-op — all activation is handled by `checkout.session.completed` or the trial-expiration cron to avoid double-writes |
| `customer.subscription.updated` | See below |
| `customer.subscription.deleted` | Set `plan = 'free'`, `team_limit = 1`, `subscription_status = 'canceled'`, `subscription_cancel_at = NULL`, quarantine subdomain (existing logic) |
| `subscription_schedule.released` | Schedule executed all phases normally; clear `stripe_schedule_id = NULL`. (`plan`/`team_limit` already written by the preceding `customer.subscription.updated`.) |
| `subscription_schedule.canceled` | Schedule was explicitly cancelled before executing; clear `pending_plan = NULL`, `pending_plan_at = NULL`, `stripe_schedule_id = NULL`. Match to org via `schedule.metadata.org_id` (set when creating the schedule). |
| `invoice.payment_succeeded` | Set `subscription_status = 'active'` (existing) |
| `invoice.payment_failed` | Set `subscription_status = 'past_due'`, send payment failure email (existing) |

**`checkout.session.completed` — detail:**

Branch on `session.mode`:

*`mode: 'subscription'`* (direct paid upgrade or re-upgrade via `POST /api/billing/create-checkout`):

1. Read `session.metadata.org_id`, `session.customer`, `session.subscription`.
2. Retrieve the subscription to get its first line item price ID: `stripe.subscriptions.retrieve(session.subscription)`.
3. Map price ID to plan and team limit:
   - `STRIPE_CLUB_SMALL_PRICE_ID` → `plan = 'club_small'`, `team_limit = 10`
   - `STRIPE_CLUB_LARGE_PRICE_ID` → `plan = 'club_large'`, `team_limit = NULL`
4. Write `plan`, `team_limit`, `stripe_customer_id` (if not already set), `stripe_subscription_id`, `subscription_status = 'active'` to the org row in a single update.
5. Apply existing subdomain-restore logic (re-upgrade within quarantine window).

*`mode: 'setup'`* (add payment method during trial):

1. Read `session.setup_intent`, `session.customer`, `session.metadata.org_id`.
2. Retrieve the SetupIntent to get `payment_method`.
3. Call `stripe.customers.update(customer, { invoice_settings: { default_payment_method } })`.
4. Write `stripe_customer_id` to org if not already set.

**`customer.subscription.updated` — detail:**

This event fires for multiple reasons; the handler must branch on the actual change:

| Condition | Action |
|---|---|
| `cancel_at_period_end = true` | Set `subscription_cancel_at = subscription.cancel_at` (Unix → timestamptz). `subscription_status` stays `'active'`. |
| `cancel_at_period_end = false` (reactivation of full-cancel) | Clear `subscription_cancel_at = NULL`. Do **not** touch `pending_plan` here — this event is not a reliable signal for schedule cancellation. |
| Price ID changed to `STRIPE_CLUB_SMALL_PRICE_ID` (schedule phase executed) | Set `plan = 'club_small'`, `team_limit = 10`, `pending_plan = NULL`, `pending_plan_at = NULL`. `stripe_schedule_id` cleared by the subsequent `subscription_schedule.released` event. |
| Price ID changed to `STRIPE_CLUB_LARGE_PRICE_ID` (direct upgrade) | Set `plan = 'club_large'`, `team_limit = NULL`. |
| Any other update | No DB change required. |

Access gating must treat `subscription_cancel_at IS NOT NULL` the same as an active subscription — the org retains full club access until `customer.subscription.deleted` fires.

---

### Customer Portal Configuration

The Stripe Customer Portal is used only for payment method management, invoice history, and cancellation. **Plan switching must be disabled** — allowing it would bypass the app's custom plan-change logic (deferred Large → Small downgrade via Subscription Schedule, trial-period upgrades, team-limit writes) and leave the DB out of sync with Stripe.

Configure the portal in the Stripe Dashboard under **Settings → Billing → Customer portal**:

| Feature | Setting |
|---|---|
| Payment methods | **Enabled** — customers can add, remove, and update saved cards |
| Invoice history | **Enabled** — customers can view and download past invoices |
| Cancel subscription | **Enabled** — triggers `customer.subscription.updated` (`cancel_at_period_end = true`) which the webhook already handles |
| Update subscriptions (plan change) | **Disabled** — plan changes go through `POST /api/billing/change-plan` only |
| Pause subscription | **Disabled** |
| Customer information updates | Disabled (name/address not needed for this flow) |

The `POST /api/billing/portal` route must pass a `return_url` so users land back on the Club Billing page after exiting the portal. Stripe enforces the allowed-domains list configured in the portal settings, so ensure the production domain is listed there.

The "Cancel plan" button on the Club Billing page calls `POST /api/billing/cancel` directly (not the portal) to keep cancellation in-app and preserve the ability to show the custom "Canceling" badge and reactivation flow. The portal's cancel feature is a fallback for users who reach the portal directly.

---

## Feature Gating

### Club Dashboard Access

The layout guard currently checks `plan === 'club'`. Replace it with a compound check — **both** conditions must be true:

```
plan IN ('club_small', 'club_large')
AND subscription_status IN ('trialing', 'active', 'past_due')
```

`past_due` retains access to give the owner time to resolve a failed payment before features are revoked.

Neither condition alone is sufficient. An org with `plan = 'free'` and a stale `subscription_status = 'trialing'` (e.g., from a partial write) must not gain access. An org with `plan = 'club_small'` and `subscription_status = 'canceled'` has already been downgraded and must not retain access. Pending cancellation (`subscription_cancel_at IS NOT NULL`) is not a separate check — the org's `subscription_status` is still `'active'` during that window, so the existing condition covers it.

### Team Creation Limits

Enforced in the `create_club_team` RPC and at the API layer (not RLS, since limits are per-org not per-user):

1. Count current teams for the org.
2. If `team_limit IS NOT NULL` and `count >= team_limit`, return an error.
3. Return a clear message: "You've reached your plan limit of X teams."

### Over-Limit Downgrade

When an org is downgraded to Free with >1 team:

- Existing teams are preserved, members retain access.
- Team creation is blocked.
- A persistent warning banner is shown on the Teams page: "You have X teams but your Free plan allows 1. Upgrade to add more, or archive teams to stay on Free."

---

## Upgrade Entry Points

### Free → Club Small or Club Large

- **Entry point:** `/dashboard/settings?tab=plan` (existing redirect destination for free orgs)
- The Plan tab shows a pricing comparison card (Free | Club Small | Club Large).
- User selects a tier → confirmation screen → "Start 90-day free trial" button.
- On confirm, calls `POST /api/billing/start-trial`, then redirects to `/dashboard/club`.

### Club Small → Club Large (upgrade during trial or active subscription)

- Available from the Club Billing page.
- During trial: updates `plan` and `team_limit` in DB only. Trial period is unchanged.
- On active subscription: creates a Stripe subscription update. Proration applied by Stripe.

### Club Large → Club Small (downgrade)

- Available from the Club Billing page (owner only).
- **Downgrade is never blocked** — an org is never locked into a higher tier because of team count. The user is always allowed to proceed.
- If the org currently has >10 teams, a warning is shown on the confirmation screen before the user commits: "You have X teams. Club Small allows 10. Existing teams will remain accessible, but you won't be able to create new ones until you're under the limit."
- After confirming, the downgrade behavior depends on context:

**Active subscription (deferred):**

A plain `subscriptions.update` with `proration_behavior: 'none'` changes the price immediately — it only suppresses proration credits, it does not defer the change. To defer the downgrade to period end, use a Stripe Subscription Schedule:

1. Create a schedule from the existing subscription: `subscriptionSchedules.create({ from_subscription: subscriptionId, metadata: { org_id: orgId } })`. Including `org_id` in metadata allows `subscription_schedule.*` webhook events to be matched to the org without a Stripe→DB lookup by schedule ID.
2. Update the schedule with a second phase starting at the current period end: `subscriptionSchedules.update(scheduleId, { phases: [{ ...currentPhase }, { items: [{ price: STRIPE_CLUB_SMALL_PRICE_ID }], start_date: currentPeriodEnd }] })`.
3. Immediately write `pending_plan = 'club_small'`, `pending_plan_at = currentPeriodEnd`, and `stripe_schedule_id = scheduleId` to the org row.

`plan` and `team_limit` are **not** written immediately — the org retains Club Large access until the schedule fires. The UI reads `pending_plan` and `pending_plan_at` to display "Your plan will change to Club Small on [date]."

**When the schedule executes at period end:** Stripe fires `customer.subscription.updated` with the new price ID. The webhook detects the price change and writes `plan = 'club_small'`, `team_limit = 10`, `pending_plan = NULL`, `pending_plan_at = NULL`. Stripe then fires `subscription_schedule.released`; the webhook clears `stripe_schedule_id`.

**When the schedule is cancelled** (e.g. user re-upgrades to Large via `POST /api/billing/change-plan`): call `subscriptionSchedules.cancel(stripe_schedule_id)` before applying the upgrade. Stripe fires `subscription_schedule.canceled`; the webhook clears `pending_plan`, `pending_plan_at`, and `stripe_schedule_id`. Do not rely on `customer.subscription.updated` to detect this — that event fires for many ordinary subscription mutations and cannot be uniquely identified as a schedule cancellation.

**Trial (immediate):**
- `plan` and `team_limit` are updated immediately in the DB (`plan = 'club_small'`, `team_limit = 10`). No Stripe action.
- If the org has >10 teams at this point, existing teams remain accessible but team creation is blocked at the limit.

**Over-limit enforcement after downgrade takes effect:**
- Existing teams above the limit are preserved and members retain full access — no data is hidden or locked.
- Team creation is blocked by the existing `team_limit` check.
- A persistent warning banner is shown on the Teams page: "You have X teams but Club Small allows 10. Archive teams or upgrade to Club Large to add more."

### Cancel Subscription

Cancellation is two-phase in Stripe:

1. **Phase 1 — Pending cancellation:** User clicks "Cancel plan" (or cancels via the Stripe portal). This sets `cancel_at_period_end = true` on the Stripe subscription. Stripe fires `customer.subscription.updated`; the webhook writes `subscription_cancel_at`. Access remains fully active. `subscription_status` stays `'active'`.
2. **Phase 2 — Final deletion:** At period end, Stripe fires `customer.subscription.deleted`. The webhook sets `plan = 'free'`, `team_limit = 1`, `subscription_status = 'canceled'`, `subscription_cancel_at = NULL`, and quarantines the subdomain.

**Reactivation:** The "Reactivate" button on the billing page calls `POST /api/billing/reactivate`. The route calls `stripe.subscriptions.update(stripe_subscription_id, { cancel_at_period_end: false })`. Stripe fires `customer.subscription.updated` with `cancel_at_period_end = false`; the webhook clears `subscription_cancel_at` and the UI returns to the normal active state. The route itself makes no DB write — the webhook is the sole writer for this transition.

Data is never deleted.

---

## UI Requirements

### Pricing / Upgrade Page (`/dashboard/settings?tab=plan`)

- Three-column comparison card: Free | Club Small | Club Large.
- Highlight current plan.
- "Start free trial" CTA on Club Small and Club Large for free-tier users.
- For trial users: show "Trial active — X days remaining" with an "Add payment method" CTA.
- For paid users: show current plan and a "Change plan" link to the Stripe portal.

### Club Billing Page (`/dashboard/club/billing`)

Status badge and messaging derive from DB state as follows:

| State | Badge | Message |
|---|---|---|
| `subscription_status = 'trialing'` | Trial | "Your trial ends on [date] — X days remaining." |
| `subscription_status = 'active'`, `pending_plan = NULL`, `subscription_cancel_at = NULL` | Active | — |
| `subscription_status = 'active'`, `pending_plan = 'club_small'` | Downgrading | "Your plan will change to Club Small on [date]. You'll retain Club Large access until then." |
| `subscription_status = 'active'`, `subscription_cancel_at IS NOT NULL` | Canceling | "Your plan will be canceled on [date]. You have full access until then." + "Reactivate" button |
| `subscription_status = 'past_due'` | Past Due | "Payment failed — please update your payment method." + "Update payment method" button (portal) |
| `subscription_status = 'canceled'` | Canceled | "Your subscription has ended." |

Additional elements:

- "Add payment method" button (links to Stripe setup session) when trialing and no payment method on file.
- "Manage payment method" button (Stripe portal — payment method + history only) when `stripe_subscription_id IS NOT NULL` and status is not `'canceled'`. Plan switching is disabled in the portal; plan changes are handled in-app only.
- "Cancel plan" button when `subscription_status = 'active'` and `stripe_subscription_id IS NOT NULL` and `subscription_cancel_at IS NULL` and `pending_plan IS NULL`. This calls `POST /api/billing/cancel` directly, not the portal, to keep the cancellation flow in-app.
- Billing history link (Stripe portal) when `stripe_subscription_id IS NOT NULL`.
- For orgs where `stripe_subscription_id IS NULL` and `subscription_status = 'active'` (admin/pilot upgrades): show no subscription-management buttons. Display a single note in place of the action area: "Managed account — contact us to make changes."

---

## Email Notifications

All emails sent via the existing Resend integration.

| Trigger | Subject |
|---|---|
| Trial day 60 | "30 days left in your Lista Club trial" |
| Trial day 83 | "7 days left — add a payment method to keep your club" |
| Trial day 89 | "Your trial ends tomorrow" |
| Trial expired, payment found → converted | "You're now on Lista Club [Small/Large]" |
| Trial expired, no payment → downgraded | "Your trial has ended — your club has moved to Free" |
| Payment succeeded | "Payment confirmed — thanks for subscribing" |
| Payment failed | "Action required: payment failed for [org name]" |
| Subscription cancelled | "Your Lista Club subscription has been cancelled" |

---

## Edge Cases

**Re-subscribing after cancellation:** Existing logic in `create-checkout` already handles this (clears stale `canceled` state). Extend to handle both price IDs.

**Trial already used:** `trial_ends_at` is never cleared, so `trial_ends_at IS NOT NULL` is the definitive "trial already consumed" signal. Whether a trial is currently active is derived from `subscription_status = 'trialing'` — not from `trial_ends_at` alone. `POST /api/billing/start-trial` checks for a non-null `trial_ends_at` and returns an error, directing the user to Stripe Checkout to subscribe directly without a trial.

**Club Small → Club Large mid-trial:** Plan field updated, `team_limit` set to null. No Stripe action. Trial end date unchanged.

**Subdomain on downgrade:** Existing quarantine logic applies unchanged — subdomain is preserved for 180 days to prevent squatting.

**JOGA FC pilot:** Currently `plan = 'club'` with custom pricing handled outside this flow. Migration backfills them (and all other existing club orgs) to `club_large` with `team_limit = NULL`. Their Stripe subscription (if any) is unaffected. The self-serve upgrade flow does not apply to them.

**Admin manual upgrade (`POST /api/admin/upgrade`):** The existing route is updated to accept `plan: 'club_small' | 'club_large'` and write the correct fields for each tier. Intended for testing and pilot programs (e.g. JOGA FC) where Stripe billing is handled separately or not at all.

Fields written on a successful admin upgrade:

| Field | Value |
|---|---|
| `plan` | `'club_small'` or `'club_large'` (from request body) |
| `team_limit` | `10` for `club_small`; `NULL` for `club_large` |
| `subscription_status` | `'active'` |
| `trial_ends_at` | `now()` if currently `NULL` — marks the org trial-ineligible so it cannot claim a self-serve trial later |

`stripe_customer_id` and `stripe_subscription_id` are left untouched — the admin upgrade does not create or modify any Stripe objects. The route remains gated behind `ADMIN_UPGRADE_CODE` and restricted to org owners.

---

## Out of Scope

- Transaction fees (2.5% on registration payments) — separate feature
- Custom domain setup for Club Large — separate feature
- Admin-facing billing dashboard — separate feature

---

## Testing Checklist

**Trial lifecycle:**
- [ ] Free org owner sees pricing comparison and can start a trial
- [ ] Trial sets correct `plan`, `trial_ends_at`, `subscription_status`, `team_limit`; `trial_ends_at` is never cleared after
- [ ] Trial org satisfies compound access gate (`plan` + `subscription_status`)
- [ ] Club Small trial: can create up to 10 teams, blocked on 11th with correct error message
- [ ] Club Large trial: unlimited team creation
- [ ] Second trial attempt blocked (`trial_ends_at IS NOT NULL`) and directed to checkout

**Reminders:**
- [ ] Trial reminder sent at day 60 window (29–31 days remaining)
- [ ] Trial reminder sent at day 83 window (6–8 days remaining)
- [ ] Trial reminder sent at day 89 window (0–2 days remaining)
- [ ] Sent-at columns prevent duplicate sends on rerun within the same window
- [ ] Reminder not sent if `subscription_status` is no longer `'trialing'`

**Payment method:**
- [ ] "Add payment method" setup session created with `metadata.org_id`
- [ ] `checkout.session.completed (mode: setup)` retrieves SetupIntent, sets customer `invoice_settings.default_payment_method`
- [ ] `stripe_customer_id` written to org if not already set
- [ ] No subscription created during setup flow

**Trial expiration cron:**
- [ ] Cron skips orgs where `stripe_subscription_id IS NOT NULL` (idempotency guard)
- [ ] Cron detects existing active Stripe subscription (step 2): writes `stripe_subscription_id` and `subscription_status = 'active'` to DB before skipping — org is not retried on the next cron run
- [ ] Cron reads `invoice_settings.default_payment_method`; takes downgrade path if null
- [ ] Cron creates subscription with explicit `default_payment_method` and idempotency key `trial-convert-{orgId}`
- [ ] Cron writes `stripe_subscription_id` and `subscription_status = 'active'` immediately after `subscriptions.create`
- [ ] Org without payment method downgraded: `plan = 'free'`, `team_limit = 1`, `subscription_status = null`; `trial_ends_at` preserved

**Plan changes:**
- [ ] Club Small → Club Large mid-trial: `plan` and `team_limit` update immediately, trial continues
- [ ] Active subscription Small → Large: Stripe subscription item updated, `plan` and `team_limit` written by `customer.subscription.updated` webhook
- [ ] Active subscription Large → Small: Subscription Schedule created, `pending_plan` and `pending_plan_at` written; org retains Large access
- [ ] Billing page shows "Downgrading" badge with correct date when `pending_plan` is set
- [ ] At period end, schedule fires: `customer.subscription.updated` sets `plan = 'club_small'`, `team_limit = 10`, clears `pending_plan`
- [ ] Large → Small with >10 teams: warning shown, downgrade allowed, team creation blocked after limit takes effect

**Cancellation:**
- [ ] "Cancel plan" sets `cancel_at_period_end = true`; `subscription_cancel_at` written by webhook
- [ ] Billing page shows "Canceling" badge and access-until date
- [ ] Reactivation clears `subscription_cancel_at`; UI returns to Active state
- [ ] `customer.subscription.deleted`: `plan = 'free'`, `team_limit = 1`, `subscription_status = 'canceled'`, `subscription_cancel_at = NULL`, subdomain quarantined
- [ ] Re-upgrade after cancellation skips trial, goes straight to checkout
- [ ] Data preserved after cancellation

**Webhooks:**
- [ ] `checkout.session.completed (mode: subscription)`: maps price ID to correct `plan` and `team_limit`, writes all four fields
- [ ] `checkout.session.completed (mode: setup)`: sets customer invoice default, writes `stripe_customer_id`
- [ ] `customer.subscription.created`: no-op (no DB write)
- [ ] `invoice.payment_succeeded`: sets `subscription_status = 'active'`
- [ ] `invoice.payment_failed`: sets `subscription_status = 'past_due'`

**Admin upgrade:**
- [ ] `POST /api/admin/upgrade` with `plan: 'club_small'` sets `plan`, `team_limit = 10`, `subscription_status = 'active'`
- [ ] `POST /api/admin/upgrade` with `plan: 'club_large'` sets `plan`, `team_limit = NULL`, `subscription_status = 'active'`
- [ ] Admin upgrade sets `trial_ends_at = now()` when previously `NULL`, leaving it unchanged if already set
- [ ] Admin-upgraded org cannot later claim a self-serve trial
- [ ] Route rejected without valid `ADMIN_UPGRADE_CODE`
- [ ] Route rejected for non-owners

**Migration:**
- [ ] `plan = 'club'` backfill runs before new constraint is added; all existing orgs become `club_large` with `team_limit = NULL` and `trial_ends_at` set
- [ ] Backfilled org that later cancels to Free is blocked from starting a self-serve trial (`trial_ends_at IS NOT NULL`)
- [ ] All `plan = 'free'` orgs get `team_limit = 1`
- [ ] `pending_plan`, `pending_plan_at`, `stripe_schedule_id`, `subscription_cancel_at`, `trial_ends_at`, `team_limit`, and reminder sent-at columns added cleanly
