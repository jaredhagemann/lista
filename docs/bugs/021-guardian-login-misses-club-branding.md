# BUG-021 — A guardian signing in to a club-tier team gets the default Lista experience, not the club's

**Severity:** P1
**Status:** Open — needs the production probe below
**Reported:** 2026-09-17 by the user, while testing in production
**Area:** tenancy / branding
**Evidence class:** Mixed — **symptom reported in production** (user, 2026-09-17); subdomain routing **confirmed working in production** for another account the same day; the code paths below are **Static**
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

**The rest of production white-labelling works.** The user's own account lands on `slofc.lista.team` when it
switches to that team (user, 2026-09-17), so `lista.team` is live, the org's subdomain is active, and both the
switcher redirect and hostname branding work for at least one account. Whatever fails, fails for this account.

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

Not diagnosed. **Ruled out 2026-09-17:** "production isn't on `lista.team`". It is, and the subdomain
redirect works for the reporter's own account on the same org.

What is left depends on a detail that is itself unclear — how this player and guardian are actually
recorded. The account shows **one** profile in the switcher, labelled *"U10 Girls (Player)"*, the player's
page shows **"Dad"** beside the contact email, and the player has no sign-in of their own (user, 2026-09-17).
Two different shapes produce roughly that screen:

**(a) The intended managed-profile shape.** The child is a profile with no auth user, a `team_members` row
with role `player`, and a `profile_managers` link to the guardian's account. The guardian has no membership
of their own. Then `activeMembership` (`dashboard/layout.tsx:93`) finds no row for the active profile and
falls through to `allMemberships[0]` — the child's. That resolves the club org, so the layout *should*
redirect. If it doesn't, the defect is in this fallback path or in something before it, and it would hit
every guardian.

**(b) The invite attached the guardian's own account as the player.** The guardian's profile itself holds
the `player` membership, "Dad" is that profile's own contact detail, and no child profile exists. Then the
account is an ordinary team member and should be branded like any other — which points the defect somewhere
other than guardianship, and raises a **separate** question about what the invite created. Compare
[BUG-002](./fixed/002-profile-managers-claim-child.md) (guardian links) and
[BUG-011](./011-identity-differs-web-vs-mobile.md) (identity differs by client).

The earlier "guardian is also on another, non-club team" hypothesis needs the same data: the reporter says
this is their only guardian account, which doesn't yet say how many teams it belongs to.

## Production probe

Read-only, to be run in the production SQL editor with the guardian's email. It settles (a) vs (b) and shows
exactly which team and org the dashboard would resolve.

```sql
-- 1. The account, its memberships, and each team's org branding
select p.id as profile_id, p.full_name, p.active_team_id,
       tm.team_id, tm.role, t.name as team_name,
       t.organization_id, o.name as org_name, o.plan, o.subdomain, o.subdomain_status
from profiles p
left join team_members tm on tm.profile_id = p.id
left join teams t on t.id = tm.team_id
left join organizations o on o.id = t.organization_id
where p.email = '<guardian email>';

-- 2. Profiles this account manages, and their memberships
select pm.managed_id, mp.full_name, mp.email, pm.relationship,
       tm.team_id, tm.role, t.name as team_name, o.subdomain, o.subdomain_status
from profile_managers pm
join profiles mp on mp.id = pm.managed_id
left join team_members tm on tm.profile_id = pm.managed_id
left join teams t on t.id = tm.team_id
left join organizations o on o.id = t.organization_id
where pm.manager_id = (select id from profiles where email = '<guardian email>')
  and pm.managed_id <> pm.manager_id;
```

Reading it:
- Query 1 returns a membership row on the club team → shape **(b)**: the account is the player.
- Query 1 returns no membership (or only non-club teams) and query 2 returns the child on the club team →
  shape **(a)**.
- Either way, note whether `subdomain_status` is `active` and `plan` is a club tier on the row that should
  brand the dashboard, and whether `active_team_id` points at that team.

## Proposed fix

Depends on the probe. If the branding org must come from a managed child's membership, the active team — and
therefore the org whose branding applies — should be resolved from the team actually being viewed, with
managed-child memberships counting for it, rather than from whichever membership happens to sort first.

## Regression test

Against the unfixed code: a guardian whose managed child is on a club-tier team with an active subdomain,
and whose own memberships are elsewhere or absent, resolves the **child's club team** as the active team,
and the dashboard sends them to that org's subdomain instead of to `lista.team`. Cover the "viewing as
myself" and "viewing as the child" cases, and a guardian with children on two teams.
