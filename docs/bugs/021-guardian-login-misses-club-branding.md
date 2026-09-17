# BUG-021 — A guardian signing in to a club-tier team gets the default Lista experience, not the club's

**Severity:** P1
**Status:** Open — needs information (see Open questions)
**Reported:** 2026-09-17 by the user, while testing in production
**Area:** tenancy / branding
**Evidence class:** Mixed — **symptom reported in production** (user, 2026-09-17, details still being gathered); the code paths below are **Static**
**Last verified:** `f28b0d5fa`, code inspection, 2026-09-17

## Symptom

Signing in as a **guardian of a player on a club-tier team** shows the default Lista experience: no club
subdomain in the address bar, and no club logo, name or colors. The same team is white-label on the club
plan, so the guardian should see the club's branding.

## Reproduction

Reported from production; not yet reproduced locally, and not yet isolated to guardians specifically.

1. Sign in as a guardian whose managed child is on a club-tier team with an active subdomain.
2. Open the dashboard.

**Expected:** the club's subdomain, logo, name and colors.
**Actual:** the default Lista domain and branding.

**Not yet established:** whether a coach or an adult member of the same team *does* get the branding in
production. Until that is known, this may not be guardian-specific at all — see hypothesis 1.

## Evidence

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

## Candidate causes

Not diagnosed. Three hypotheses, all consistent with the report; the answers under **Open questions**
separate them.

1. **Production isn't on `lista.team` yet.** Subdomain routing and the `.lista.team` cookie scope are
   switched off with `SUBDOMAIN_ROUTING_ENABLED=false` on deployments that don't run on `lista.team`
   (`src/lib/supabase/middleware.ts:46`, `src/app/actions/team.ts:100`). On a `*.vercel.app` host,
   `resolveTenant` also finds no org. Then **nobody** gets club branding and the guardian account is
   incidental. The production cron domain recorded on
   [BUG-008](./fixed/008-cron-routes-redirected-to-login.md) is `lista-umber.vercel.app`, which makes this
   the leading hypothesis.
2. **Branding follows the guardian's own membership, not the child's team.** `activeMembership` prefers a
   membership of the *active profile*. A guardian viewing as **themselves** who is also a member of some
   other, non-club team resolves that team's org — and the layout then redirects **away** from the club
   subdomain to `lista.team`, because the active team has no club subdomain. The child's club team can be
   the one on screen while the branding follows the guardian's own team.
3. **A guardian who is not a team member at all** falls through to `allMemberships[0]`, the first membership
   of any managed child, ordered by `created_at`. With children on more than one team, that is not
   necessarily the team being viewed.

Hypotheses 2 and 3 are read from the code and have not been run.

## Open questions

Needed before this can be reproduced or fixed:

| # | Question | Why it matters |
| --- | --- | --- |
| 1 | What hostname were you on, and does **any** account ever see a club subdomain in production today? | Separates hypothesis 1 from the rest |
| 2 | Is the guardian account itself a member of the club team (parent role), or only linked through the child? | Separates 2 from 3 |
| 3 | Was the "Viewing as" switcher set to the child or to the guardian? | Decides which profile drove `activeMembership` |
| 4 | Is the guardian account on any **other** team? | Hypothesis 2 needs a second, non-club membership |

## Proposed fix

Depends on the answers. If hypothesis 1 holds, this is a deployment/DNS task rather than a code defect, and
the ticket should record what production needs before white-label works at all. If 2 or 3 hold, the active
team — and therefore the org whose branding applies — should be resolved from the team actually being
viewed, and a guardian's managed-child memberships should count for that, rather than the first membership
that happens to sort first.

## Regression test

Against the unfixed code: a guardian whose managed child is on a club-tier team with an active subdomain,
and whose own memberships are elsewhere or absent, resolves the **child's club team** as the active team,
and the dashboard sends them to that org's subdomain instead of to `lista.team`. Cover the "viewing as
myself" and "viewing as the child" cases, and a guardian with children on two teams.
