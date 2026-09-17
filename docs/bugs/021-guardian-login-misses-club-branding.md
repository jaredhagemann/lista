# BUG-021 — A guardian signing in to a club-tier team gets the default Lista experience, not the club's

**Severity:** P1
**Status:** Open — cause diagnosed, not yet fixed
**Reported:** 2026-09-17 by the user, while testing in production
**Area:** tenancy / branding
**Evidence class:** **Reproduced** (local stack, 2026-09-17) from the production account shape; symptom reported in production the same day
**Last verified:** `f28b0d5fa`, code inspection, 2026-09-17

## Symptom

Signing in as a **guardian of a player on a club-tier team** shows the default Lista experience: no club
subdomain in the address bar, and no club logo, name or colors. The same team is white-label on the club
plan, so the guardian should see the club's branding.

## Reproduction

Reported from production, then reproduced on a local stack (see Evidence). It affects any guardian whose
only link to a club-tier org is a managed child.

1. Sign in as a guardian whose managed child is on a club-tier team with an active subdomain.
2. Open the dashboard.

**Expected:** the club's subdomain, logo, name and colors.
**Actual:** the default Lista domain and branding.

**The rest of production white-labelling works.** The user's own account lands on `slofc.lista.team` when it
switches to that team (user, 2026-09-17), so `lista.team` is live, the org's subdomain is active, and both the
switcher redirect and hostname branding work for at least one account. Whatever fails, fails for this account.

## How branding reaches the browser

Branding is derived from the **hostname only**. Nothing about the signed-in user feeds it:

- `apps/web/src/lib/supabase/tenant.ts:55` — `resolveTenant(hostname)` looks the org up by subdomain or
  custom domain, and returns `null` for `lista.team`, `www`, `localhost` and any other host.
- `apps/web/src/middleware.ts:18` — resolves the tenant per request and injects the `x-tenant-*` headers.
- `apps/web/src/app/dashboard/layout.tsx:193` — the nav takes its logo and org name from those headers
  (`tenant?.logoUrl`, `tenant?.orgNamePublic`).

So a user only ever sees club branding if their **browser is on the club's subdomain**. Getting them there
is the job of the redirect in `dashboard/layout.tsx:144`, which is where a guardian can differ from a coach:

- `apps/web/src/app/dashboard/layout.tsx:144` — redirects to `https://{activeOrgSubdomain}.lista.team/dashboard`,
  and back to `lista.team` when the active team has no club subdomain.
- `apps/web/src/app/dashboard/layout.tsx:93` — `activeMembership`, which decides `activeOrgId` and therefore
  `activeOrgSubdomain`, is the **active profile's** membership: the active profile's `active_team_id` first,
  then any membership of the active profile, and only then the first membership of anyone (`allMemberships[0]`).
- `apps/web/src/app/actions/team.ts:100` and `dashboard/layout.tsx:144` — both redirects are suppressed
  entirely when `SUBDOMAIN_ROUTING_ENABLED=false` or `TENANT_OVERRIDE_HOSTNAME` is set.

Spec: [`docs/specs/club-subdomain-routing.md`](../specs/club-subdomain-routing.md).

## Cause

**Diagnosed and reproduced on a local stack, 2026-09-17.** A guardian cannot read the `organizations` row
for their child's team, so the dashboard has no subdomain to send them to.

The `organizations` SELECT policy
(`supabase/migrations/20260416000001_organization_members.sql:99`, "Orgs visible to members") admits two
kinds of caller:

```sql
exists (select 1 from teams t
          join team_members tm on tm.team_id = t.id
          join profiles p on p.id = tm.profile_id
        where t.organization_id = organizations.id and p.auth_user_id = auth.uid())
or
exists (select 1 from organization_members om
          join profiles p on p.id = om.profile_id
        where om.organization_id = organizations.id and p.auth_user_id = auth.uid())
```

Both require a profile that is **itself** a member and whose `auth_user_id` is the caller. A guardian is
neither: the membership belongs to the managed child, and a managed profile has `auth_user_id = null`.
`is_team_member()` has covered managed children since `20260303000002_managed_profiles.sql:67`, but this
policy doesn't use it.

The dashboard layout then does this (`apps/web/src/app/dashboard/layout.tsx:118`):

```ts
supabase.from("organizations").select("subdomain, subdomain_status, plan, subscription_status")
```

which returns nothing, so `activeOrgSubdomain` stays `null`, the redirect at `layout.tsx:144` never fires,
the browser stays on `lista.team`, and `resolveTenant` reports no tenant. Branding is hostname-derived, so
the guardian gets the default Lista look.

**Second symptom from the same read:** `hasTrainingAccess` is computed from that same empty row
(`layout.tsx:131`), so a guardian on a club team never sees the **Training** nav item
(`apps/web/src/components/layout/dashboard-nav.tsx:71`).

Everything *before* the org read is fine, which is why the team still appears correctly in the switcher.

## Evidence

Production data for the reported account (user-run SQL, 2026-09-17), which establishes the shape:

| | |
| --- | --- |
| Guardian profile | `8059acf9…`, `auth_user_id` equal to its own id, `active_team_id` = the child's team |
| Guardian memberships | **none** |
| Managed child | `c14c62c9…` "Zoey Butler", `managed-…@lista.internal`, `auth_user_id` **null**, relationship "dad" |
| Child membership | team `cdcc4967…` "U10 Girls", role `player` |
| Org | plan `club_large`, subdomain `slofc`, `subdomain_status` `active` |

So this is the intended managed-profile shape, not a bad invite: the child has no sign-in of their own, and
"Dad" beside the contact email is the guardian's own detail on the child's page.

Local reproduction, `tests/rls/guardian-branding-probe.test.ts` (not committed — it asserts the *fixed*
behavior and fails today), replaying the layout's queries as the guardian against the same shape:

| Layout step | Result |
| --- | --- |
| own profile, managed links, `team_members` with `teams(*)` | resolve correctly |
| `activeMembership` → `activeOrgId` | resolves to the club org |
| **`organizations` row for that org** | **empty — `plan` is `undefined`** |

`AssertionError: expected undefined to be 'club_large'`

The same policy shape also guards `organization_members` ("org members can view org_members"), which is
harmless here: a guardian genuinely has no org role.

## Proposed fix

Let the `organizations` SELECT policy admit a caller who manages a profile on one of the org's teams —
the rule `is_team_member()` already applies everywhere else — and keep the org-member branch as is.
Guardians would then read the same org row any team member already can.

Worth settling in the same change: this policy hands every team member the whole row, billing columns
included (`stripe_customer_id`, `subscription_status`). Widening the audience is a good moment to decide
whether reads should be column-limited, which [BUG-005](./fixed/005-org-billing-columns-self-editable.md)
touched on for writes only.

## Regression test

Against the unfixed code: a guardian whose only link to a club-tier org is a managed child reads that org's
`plan`, `subdomain` and `subdomain_status` — failing today, as the probe above shows. Cover a guardian with
no memberships of their own, a guardian who is also a member of a different org's team (they must not gain
that org), and a non-guardian outsider (still refused). Add a layout-level assertion that the resolved
`activeOrgSubdomain` for such a guardian is the club's subdomain.
