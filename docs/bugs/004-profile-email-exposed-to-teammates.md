# BUG-004 — Private contact fields are readable by any teammate via the data API

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 4)
**Area:** privacy / rls

## Symptom

The privacy page states that email is visible to admins and profile managers. In fact an ordinary player
account can read any teammate's email — including a coach's — by querying `profiles` directly. The UI
hides the field; the data boundary does not.

## Reproduction

**Reproduced** via SQL probe.

1. Sign in as an ordinary player on a team.
2. `SELECT email FROM profiles WHERE id = '<coach profile uuid>'` via PostgREST.

**Expected:** no email returned — private contact fields are not part of the team-visible projection.
**Actual:** the coach's email is returned.

**Environment:** local (probe); policy identical in all environments.

## Evidence

- Privacy statement: `apps/web/src/app/privacy/page.tsx:48`
- Profile visibility policy: `supabase/migrations/20260318000001_fix_profiles_select_for_profile_managers.sql:14`
- Probe results: `docs/reviews/2026-09-04-local-probe-results.txt`

## Cause

Team-visible profile rows expose whole columns rather than a restricted public-profile projection.

## Fix

Separate public roster fields from private account/contact fields using a secured view/table or a server
response. Birth dates need an explicit field-access decision alongside email.

**Open product decision:** who may see children's birth dates and contact details. See "Questions".

## Regression test

Assert against **direct PostgREST queries**, not rendered screens, for each role: player, parent, coach,
manager, org director.
