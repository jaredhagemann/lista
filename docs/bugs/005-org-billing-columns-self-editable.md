# BUG-005 — Club admins can edit their own subscription state directly

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 5)
**Area:** billing / rls

## Symptom

An organization admin can upgrade their own club and mark it paid by writing to the `organizations` row
directly, bypassing Stripe and the billing routes entirely.

## Reproduction

**Reproduced** via SQL probe.

1. Sign in as the owner/admin of an organization on a free plan.
2. `UPDATE organizations SET plan = 'club_large', subscription_status = 'active' WHERE id = '<org uuid>'`
   using the authenticated role.

**Expected:** billing and entitlement columns are writable only by privileged billing operations.
**Actual:** the update succeeds; the club is entitled without a Stripe subscription.

**Environment:** local (probe); policy identical in all environments.

## Evidence

- Organization UPDATE policy: `supabase/migrations/20260416000001_organization_members.sql:118`
- Billing columns: `supabase/migrations/20260519000000_club_tier_monetization.sql:19`

## Cause

Organization UPDATE access is row-wide for organization admins, with no column-level restriction on
financial/entitlement fields.

## Fix

Move billing/entitlement fields behind privileged operations, or enforce column/trigger restrictions in the
database. Ordinary organization settings must stay independently editable. Other writable columns —
provider IDs and domain settings among them — need the same column-by-column review.

Related: [[015]] covers the webhook side of subscription state integrity.

## Regression test

Assert an org admin cannot change `plan`, `subscription_status`, Stripe provider IDs, or subdomain
settings directly, while still being able to change name/branding.
