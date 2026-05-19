-- ── Club tier monetization ────────────────────────────────────────────────────
-- Expands the single 'club' plan into two tiers (club_small / club_large), adds
-- the 90-day trial lifecycle, deferred-downgrade (Subscription Schedule) state,
-- pending-cancellation tracking, and trial-reminder idempotency columns.
--
-- Spec: docs/specs/club-upgrade-monetization.md → "Database Changes".
--
-- `plan` remains the single source of truth — no separate `tier` column, and
-- the 'white_label' value is intentionally NOT introduced.
--
-- Ordering matters: every new column is added FIRST (Step 1) so the Step 2
-- backfill UPDATEs can reference them; the plan constraint is dropped before
-- the backfill and re-added after, because existing 'club' rows would violate
-- the new check if it were added before the UPDATE rewrites them.

-- ── Step 1: Add all new nullable columns ──────────────────────────────────────

-- Explicit team limit (1 = free, 10 = club_small, NULL = unlimited / club_large).
-- Must be written explicitly on every plan transition — never left implicit.
ALTER TABLE organizations ADD COLUMN team_limit integer;

-- Trial timestamp: NULL means this org has never started a trial.
-- Once set, it is NEVER cleared — it is both the expiry date and the permanent
-- "trial already consumed" signal. Whether the trial is currently active is
-- derived from subscription_status = 'trialing', not from this value.
ALTER TABLE organizations ADD COLUMN trial_ends_at timestamptz;

-- Pending plan change (Large → Small deferred downgrade via Subscription
-- Schedule). Set when the schedule is created; cleared by
-- subscription_schedule.canceled / subscription_schedule.released events (not by
-- customer.subscription.updated, which is too ambiguous to use as a
-- schedule-cancellation signal). NULL = no pending plan change. Only a downgrade
-- is ever deferred, so the only legal value is 'club_small'.
ALTER TABLE organizations
  ADD COLUMN pending_plan text
  CHECK (pending_plan IN ('club_small'));
ALTER TABLE organizations ADD COLUMN pending_plan_at timestamptz;

-- Stripe Subscription Schedule ID for the pending Large → Small downgrade.
-- Stored so subscription_schedule.* events can be matched to the org without
-- relying on ambiguous customer.subscription.updated event shapes.
-- NULL when no deferred downgrade is in progress.
ALTER TABLE organizations ADD COLUMN stripe_schedule_id text;

-- Pending cancellation timestamp. Set when cancel_at_period_end = true is
-- detected on the subscription; cleared when the subscription is reactivated
-- or finally deleted. NULL = not pending cancellation.
-- subscription_status stays 'active' during this window — access is unaffected.
ALTER TABLE organizations ADD COLUMN subscription_cancel_at timestamptz;

-- Trial reminder sent-at timestamps. NULL = not yet sent.
-- Written immediately after a successful Resend API call.
-- Used by the reminder cron to prevent duplicate sends across reruns or missed
-- days (the cron uses a ±1 day window so a missed run still fires).
ALTER TABLE organizations ADD COLUMN trial_reminder_30d_sent_at timestamptz;
ALTER TABLE organizations ADD COLUMN trial_reminder_7d_sent_at timestamptz;
ALTER TABLE organizations ADD COLUMN trial_reminder_1d_sent_at timestamptz;

-- ── Step 2: Expand the plan enum ──────────────────────────────────────────────
-- Drop the old constraint, backfill while the column is unconstrained, then add
-- the new constraint. The inline `CHECK (plan IN ('free','club'))` in
-- 20260416000000_organization_enhancements.sql was auto-named
-- organizations_plan_check by Postgres.

ALTER TABLE organizations DROP CONSTRAINT organizations_plan_check;

-- Backfilling trial_ends_at for existing club orgs (incl. JOGA FC) permanently
-- marks them trial-ineligible. They became paying/pilot customers outside the
-- self-serve flow and must never receive a free trial if they later cancel and
-- re-upgrade. trial_ends_at IS NOT NULL is the gate in start-trial; the actual
-- value is irrelevant since subscription_status != 'trialing' so it is never
-- displayed.
UPDATE organizations SET plan = 'club_large', team_limit = NULL, trial_ends_at = now() WHERE plan = 'club';
UPDATE organizations SET team_limit = 1 WHERE plan = 'free';

ALTER TABLE organizations
  ADD CONSTRAINT organizations_plan_check
  CHECK (plan IN ('free', 'club_small', 'club_large'));

-- ── Step 3: Expand subscription_status to include 'trialing' ──────────────────
-- The inline CHECK in 20260416000000_organization_enhancements.sql was
-- auto-named organizations_subscription_status_check by Postgres.

ALTER TABLE organizations DROP CONSTRAINT organizations_subscription_status_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_subscription_status_check
  CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled'));
