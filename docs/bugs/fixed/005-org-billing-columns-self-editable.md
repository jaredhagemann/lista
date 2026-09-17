# BUG-005 — Club admins can edit their own subscription state directly

**Severity:** P1
**Status:** Fixed (pending deploy verification — see Verification)
**Reported:** 2026-09-04 by readiness review (finding 5)
**Area:** billing / rls
**Evidence class:** Reproduced (local stack, re-confirmed 2026-09-16) — **unverified in deployment**
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
[BUG-015](../015-stripe-webhook-acknowledges-failed-write.md).

## Regression test

Assert no org role can write `plan`, `subscription_status` or Stripe provider IDs directly.

Test **owner and director separately** on the legitimate paths, and distinguish a permitted guarded settings
operation from a raw billing-column write:

- director changes the operational name — permitted
- director changes branding / subdomain / logo — denied (owner-only)
- owner changes branding / subdomain / logo — permitted
- either role reads billing status — permitted

---

## Fix as implemented

**Branch:** `fix/005-org-billing-columns`
**PR:** see branch
**Migration:** `supabase/migrations/20260917000003_org_updates_service_role_only.sql`

**The organizations UPDATE policy is dropped, for every role**, rather than restricted column by column.

The broader fix was chosen because no application code updates organizations through a user session. Every
writer uses the service role after its own authorization:
- the billing routes (`change-plan`, `create-checkout`, `create-setup`, `start-trial`)
- the Stripe webhook
- the trial-expiration and subdomain-quarantine crons
- the admin upgrade route
- `PATCH /api/club/settings`

The policy therefore granted nothing the app used, while exposing **every** column: plan, subscription status,
Stripe ids, trial dates and reminder stamps, team limit, pending plan changes, subdomain and quarantine
state, and custom domain. Dropping it covers the ticket's "column-by-column review" in one move, including
columns added later.

Organization settings now go only through `PATCH /api/club/settings`, which already:
- writes an allowlist of fields (name, public name, brand colors, logo, favicon, subdomain) and never billing columns
- lets directors change only the operational name, keeping branding, subdomain and logo owner-only (the existing decision)
- gates subdomains on a club plan, validates format and reserved names, and quarantines cleared subdomains

Reads are unchanged: owners and directors still see billing state (`Orgs visible to members`).

**Found and left for [BUG-013](../013-club-staffing-and-ownership-handover.md):** the DELETE policy
`Orgs deletable by org owner` lets an owner delete the organization through the data API, cascading to its teams
and their records. No app code uses it, and it contradicts D7, which says club closure archives rather than
erases. Noted on BUG-013's club-closure work.

## Verification

**Tests** — `tests/rls/organization-billing-protection.test.ts`. The direct-write cases use real authenticated
clients; the route cases call the real `PATCH /api/club/settings` against a local stack, with only the cookie
session and Redis cache invalidation mocked.

**6 failed against the unfixed schema:**

| Test | Unfixed |
| --- | --- |
| owner upgrades their club to `club_large` and marks it paid | plan became `club_large` |
| director does the same | plan became `club_large` |
| owner sets Stripe customer and subscription ids | `cus_forged` stored |
| owner clears a consumed `trial_ends_at` to claim another trial | cleared |
| owner sets subdomain and custom domain directly on the free plan | `free-…` stored |
| owner renames the org directly, bypassing the settings route | renamed |

**The ticket's legitimate-path list**, passing before and after:
- director changes the operational name via the route — 200
- director changes branding via the route — 403
- owner changes branding and public name via the route — 200
- owner smuggles `plan`, `subscription_status` and `stripe_customer_id` into the route body — ignored; only the name changes
- either role reads billing status — covered by the existing `organizations.test.ts` cases for owner and
  director SELECT of the club-tier billing columns

Full runs on a local stack reset with all migrations (pinned CLI 2.78.1):
- RLS suite: **333 passed** (previously 323)
- `apps/web` suite: **721 passed** (no application code changed)
- Root tenant/billing selection: 218 passed and the 3 unchanged [BUG-017](../017-stale-test-fixtures-three-failures.md) failures

**Before merge on staging, and after deploy in production** (read-only SQL editor):

```sql
select policyname, cmd from pg_policies where tablename = 'organizations' order by cmd;
```

Expected: `Orgs deletable by org owner` (DELETE) and `Orgs visible to members` (SELECT) — **no UPDATE row**.
