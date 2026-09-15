# BUG-005 — Club admins can edit their own subscription state directly

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 5)
**Area:** billing / rls
**Evidence class:** Reproduced (local stack) — **unverified in deployment**
**Last verified:** `5acde1074`, local stack, 2026-09-04

**Severity note:** privilege escalation, but it requires already holding an org admin role, so it is P1
under the narrow P0 definition in `README.md`.

## Symptom

An organization admin can upgrade their own club and mark it paid by writing to the `organizations` row
directly, bypassing Stripe and the billing routes entirely.

## Reproduction

**Reproduced** via SQL probe against a local stack.

1. Sign in as the owner/admin of an organization on a free plan.
2. `UPDATE organizations SET plan = 'club_large', subscription_status = 'active' WHERE id = '<org uuid>'`
   using the authenticated role.

**Expected:** billing and entitlement columns are writable only by privileged billing operations.
**Actual:** the update succeeds; the club is entitled without a Stripe subscription.

**Deployment status:** reproduced locally against the checked-in migrations. **Production behavior has not
been checked.**

## Evidence

- Organization UPDATE policy: `supabase/migrations/20260416000001_organization_members.sql:118`
- Billing columns: `supabase/migrations/20260519000000_club_tier_monetization.sql:19`
- Current settings authorization: `apps/web/src/app/api/club/settings/route.ts:55`

## Product decisions

**Already decided — reference, do not reopen:** owner and director are **not** the same permission set.

| Existing decision | Source |
| --- | --- |
| Directors may change the club's operational **name**; branding, subdomain and logo stay **owner-only** | `apps/web/src/app/api/club/settings/route.ts:55` |
| Billing **read** access is owner/director; billing **mutation** is more restricted | same |

A fix that collapses these two roles would be a regression, not a repair.

## Cause

Organization UPDATE access is row-wide for organization admins, with no column-level restriction on
financial/entitlement fields.

## Proposed fix

Move billing/entitlement fields behind privileged operations, or enforce column/trigger restrictions in the
database. Other writable columns — provider IDs and domain settings among them — need the same
column-by-column review.

Protects the opposite side of billing integrity from
[BUG-015](./015-stripe-webhook-acknowledges-failed-write.md).

## Regression test

Assert no org role can write `plan`, `subscription_status` or Stripe provider IDs directly.

Test **owner and director separately** on the legitimate paths, and distinguish a permitted guarded settings
operation from a raw billing-column write:

- director changes the operational name — permitted
- director changes branding / subdomain / logo — denied (owner-only)
- owner changes branding / subdomain / logo — permitted
- either role reads billing status — permitted
