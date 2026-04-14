# Multi-Tenant Architecture Spec
*Lista — Individual Teams + White-Label Club Installations*

**Status:** Active — decisions finalized 2026-04-13
**Last updated:** 2026-04-13

---

## Overview

Lista evolves from a single-product freemium app into a **multi-tenant platform** that serves two market segments from a single codebase:

| Segment | Experience | Domain | Pricing |
|---|---|---|---|
| Individual coach/team | Standard Lista app | lista.team | Free / Pro |
| Club / academy | Fully white-labeled, multi-team portal | `slug.lista.team` (custom domain later) | Club plan |

The key insight: `organizations` already exists in the schema as a thin container. We promote it to the primary tenant boundary, add billing/branding metadata, and build tenant-aware routing on top.

---

## Resolved Decisions

| Question | Decision |
|---|---|
| **Club admin visibility** | Wide — org admins get implicit access to all team data (rosters, schedules, events) across every team in the org. Implemented by extending `is_team_member()` and `is_team_admin()` RLS helpers. |
| **Domain strategy** | Subdomains now (`slug.lista.team` via `*.lista.team` wildcard), custom domains (`app.jogafc.org`) as Phase 2. |
| **Registration/payments** | Out of scope for this build. Deferred to a separate spec/phase after multi-tenancy is complete. |
| **White-label depth** | Full rebrand of the Lista app — zero Lista branding visible on club-plan domains. Custom logo, colors, page titles, favicon, and email sender name all use club identity. No custom public website pages — clubs already have their own sites. |
| **Plan tiers** | Free / Pro / Club — see table below. |
| **Public website pages** | Not in scope. Clubs have their own websites. Lista provides the app experience only. |

---

## Plan Tiers

| Plan | Teams | Domain | Branding | Club Admin Portal | Price |
|---|---|---|---|---|---|
| **Free** | 1 | lista.team only | Lista branded | No | $0 |
| **Pro** | Unlimited | lista.team only | Lista branded | No | ~$12/mo per team |
| **Club** | Unlimited | `slug.lista.team` → `app.jogafc.org` (Phase 2) | Full white-label app, zero Lista branding | Yes | ~$199/mo flat |

- Pro is per-team, billed by the coach/owner.
- Club is per-organization, billed by the club director. All teams under the org are included.
- Free plan is hard-limited to 1 team; the API rejects team creation beyond this.

---

## Architecture Changes

### Phase 1 — Foundation (Multi-Tenancy + Billing)

---

#### 1.1 — Enhance `organizations` Table

**Current state:** `organizations(id, name, created_at)` — no RLS, no metadata.

```sql
-- Migration: YYYYMMDDNNNNNN_organization_enhancements.sql

ALTER TABLE organizations ADD COLUMN slug         text UNIQUE;
ALTER TABLE organizations ADD COLUMN plan         text NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free', 'pro', 'club'));
ALTER TABLE organizations ADD COLUMN subdomain    text UNIQUE; -- 'jogafc' → jogafc.lista.team
-- custom_domain reserved for Phase 3
ALTER TABLE organizations ADD COLUMN custom_domain text UNIQUE;
ALTER TABLE organizations ADD COLUMN brand_color  text;        -- hex e.g. '#1a2f5e'
ALTER TABLE organizations ADD COLUMN brand_color_secondary text;
ALTER TABLE organizations ADD COLUMN logo_url     text;
ALTER TABLE organizations ADD COLUMN favicon_url  text;
ALTER TABLE organizations ADD COLUMN org_name_public text;     -- display name used in white-label UI
ALTER TABLE organizations ADD COLUMN stripe_customer_id       text;
ALTER TABLE organizations ADD COLUMN stripe_subscription_id   text;
ALTER TABLE organizations ADD COLUMN subscription_status text DEFAULT 'active'
  CHECK (subscription_status IN ('active', 'past_due', 'canceled', 'trialing'));
ALTER TABLE organizations ADD COLUMN trial_ends_at timestamptz;
ALTER TABLE organizations ADD COLUMN created_by   uuid REFERENCES profiles(id);
```

**Backfill:** Generate slugs from existing `organizations.name` (slugify, lowercase, deduplicate with numeric suffix). Set `created_by` from the team owner where discoverable.

**RLS policies for `organizations`:**
- `SELECT`: profile is a member of any team in the org, OR is an org member
- `UPDATE`: `is_org_admin(id)` — only org owners/admins can update branding, settings
- `INSERT`: any authenticated user (handled via `create_team()` RPC, not direct insert)
- `DELETE`: `is_org_owner(id)` only

---

#### 1.2 — `organization_members` Table + Club Admin Role

New table establishing org-level roles:

```sql
-- Migration: YYYYMMDDNNNNNN_organization_members.sql

CREATE TABLE organization_members (
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id      uuid REFERENCES profiles(id)      ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('owner', 'admin')),
  created_at      timestamptz DEFAULT now(),
  PRIMARY KEY (organization_id, profile_id)
);

-- RLS
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- Org members can see who else is in the org
CREATE POLICY "org members can view org_members"
  ON organization_members FOR SELECT
  USING (
    organization_id IN (
      SELECT t.organization_id FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      JOIN profiles p ON p.id = tm.profile_id
      WHERE p.auth_user_id = auth.uid()
    )
    OR is_org_admin(organization_id)
  );

-- Only org owners can manage membership
CREATE POLICY "org owners can manage org_members"
  ON organization_members FOR ALL
  USING (is_org_owner(organization_id))
  WITH CHECK (is_org_owner(organization_id));
```

**Role definitions:**
- `owner`: full control — billing, branding, subdomain, creating/archiving teams, inviting org admins. One per org (enforced by convention, not DB constraint — allows owner transfer).
- `admin`: can create teams, invite members across teams, view all team data. No billing access.

**Backfill:** Insert an `organization_members` row (`role = 'owner'`) for every existing team's `owner_id` profile, scoped to that team's `organization_id`.

**Update `create_team()` RPC:** After creating the org and team, also insert into `organization_members` with `role = 'owner'`.

---

#### 1.3 — RLS Helper Functions (Updated)

The wide visibility model means org admins implicitly have access to all team data. This is implemented by extending the two existing helpers that gate all team-scoped RLS policies.

**New helpers:**

```sql
CREATE OR REPLACE FUNCTION is_org_admin(o_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members om
    JOIN profiles p ON p.id = om.profile_id
    WHERE om.organization_id = o_id
      AND p.auth_user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_org_owner(o_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members om
    JOIN profiles p ON p.id = om.profile_id
    WHERE om.organization_id = o_id
      AND p.auth_user_id = auth.uid()
      AND om.role = 'owner'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns the org_id for a given team (used inside helper functions)
CREATE OR REPLACE FUNCTION team_org_id(t_id uuid) RETURNS uuid AS $$
  SELECT organization_id FROM teams WHERE id = t_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

**Modify existing helpers to include org admin check:**

```sql
-- Replace existing is_team_member()
CREATE OR REPLACE FUNCTION is_team_member(t_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members tm
    JOIN profiles p ON p.id = tm.profile_id
    WHERE tm.team_id = t_id
      AND (
        p.auth_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM profile_managers pm
          JOIN profiles mgr ON mgr.id = pm.manager_id
          WHERE pm.managed_id = p.id AND mgr.auth_user_id = auth.uid()
        )
      )
  )
  -- Club admins have implicit membership access to all teams in their org
  OR is_org_admin(team_org_id(t_id));
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Replace existing is_team_admin()
CREATE OR REPLACE FUNCTION is_team_admin(t_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members tm
    JOIN profiles p ON p.id = tm.profile_id
    WHERE tm.team_id = t_id
      AND p.auth_user_id = auth.uid()
      AND tm.role IN ('coach', 'manager')
  )
  -- Club admins have implicit admin access to all teams in their org
  OR is_org_admin(team_org_id(t_id));
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

**Impact:** Because every existing RLS policy on team-scoped tables already goes through `is_team_member()` or `is_team_admin()`, this single change grants club admins full cross-team read/write access with no additional policy changes. All existing policies on `events`, `availability`, `team_members`, `channels`, `messages`, `locations`, `invitations` etc. pick it up automatically.

---

#### 1.4 — Plan Enforcement

**Team creation limit (Free plan = 1 team):**

Add a check to the `create_team()` RPC:

```sql
-- Inside create_team() before INSERT INTO teams:
IF (SELECT plan FROM organizations WHERE id = v_org_id) = 'free' THEN
  IF (SELECT COUNT(*) FROM teams WHERE organization_id = v_org_id) >= 1 THEN
    RAISE EXCEPTION 'plan_limit_exceeded';
  END IF;
END IF;
```

The `/api/teams` route already calls `create_team()` — it surfaces the exception as a 402 response.

**Club subdomain access:**

Middleware checks `tenant.plan === 'club'` before serving any `*.lista.team` subdomain route. Non-club orgs that somehow have a subdomain set get redirected to `lista.team`.

---

#### 1.5 — Billing Integration (Stripe)

**New dependency:** `stripe` npm package.

**New environment variables:**
```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
```

**New API routes (`src/app/api/billing/`):**

```
POST /api/billing/create-checkout   → Create Stripe Checkout Session (org owner only)
POST /api/billing/portal            → Create Stripe Customer Portal session
POST /api/billing/webhook           → Stripe webhook handler
GET  /api/billing/status            → Current plan/status for the active org
```

**Webhook events → DB updates:**

| Event | Action |
|---|---|
| `checkout.session.completed` | Set `stripe_subscription_id`, update `plan`, set `subscription_status = 'active'` |
| `invoice.payment_succeeded` | Set `subscription_status = 'active'` |
| `invoice.payment_failed` | Set `subscription_status = 'past_due'` |
| `customer.subscription.deleted` | Set `plan = 'free'`, `subscription_status = 'canceled'`, clear `subdomain` |
| `customer.subscription.trial_will_end` | Send warning email via Resend |

**Downgrade to free:** When a Club subscription cancels, also clear `subdomain` and `custom_domain` — the club's `slug.lista.team` stops resolving and redirects to `lista.team`.

---

#### 1.6 — Tenant Resolution Middleware

The Next.js middleware resolves the active tenant (organization) from the incoming hostname before any request processing.

**Resolution logic:**

```
Request hostname          Lookup
─────────────────────     ────────────────────────────────────────────
lista.team                → null (default tenant, Lista branded)
www.lista.team            → null
jogafc.lista.team         → SELECT * FROM organizations WHERE subdomain = 'jogafc'
jogafc.org                → SELECT * FROM organizations WHERE custom_domain = 'jogafc.org'
                            (Phase 3 only — ignored until then)
```

**New file: `src/lib/supabase/tenant.ts`**

```typescript
export type TenantContext = {
  organizationId: string;
  slug: string;
  plan: 'free' | 'pro' | 'club';
  brandColor: string | null;
  brandColorSecondary: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  orgNamePublic: string | null;  // club's display name
  subdomain: string | null;
  isWhiteLabel: boolean;         // plan === 'club'
};

export async function resolveTenant(hostname: string): Promise<TenantContext | null> {
  // 1. Strip port for local dev (lista.team:3000)
  // 2. Check Redis cache: GET tenant:{hostname}
  // 3. On miss: query organizations via service role client
  // 4. Cache result with 60s TTL: SET tenant:{hostname} ...
  // 5. Return null for lista.team / www.lista.team
}

export function getTenantFromHeaders(headers: ReadonlyHeaders): TenantContext | null {
  // Read x-tenant-* headers injected by middleware
}
```

**Middleware changes (`src/middleware.ts`):**

1. Call `resolveTenant(host)` before session refresh
2. If tenant found: inject headers:
   - `x-tenant-id`, `x-tenant-plan`, `x-tenant-slug`
   - `x-tenant-brand-color`, `x-tenant-brand-color-secondary`
   - `x-tenant-logo-url`, `x-tenant-favicon-url`
   - `x-tenant-org-name`
   - `x-tenant-is-white-label` (`'true'` or `'false'`)
3. If subdomain resolves but `plan !== 'club'` → 302 to `https://lista.team`
4. Existing auth redirect logic is unchanged

**Cache invalidation:** When org branding/plan/subdomain changes (via `/api/club/settings`), delete `tenant:{hostname}` from Redis.

**Performance:** The Redis cache means the vast majority of requests pay zero DB cost for tenant resolution. The service role Supabase client used for tenant lookups is lightweight (no cookie parsing).

---

#### 1.7 — White-Label Theming (Full Rebrand)

On club-plan tenants, **no Lista branding appears anywhere**. The club's identity is used end-to-end.

**Root layout (`src/app/layout.tsx`):**

```tsx
export default async function RootLayout({ children }) {
  const tenant = getTenantFromHeaders(headers());

  // Dynamic CSS variables for brand colors
  const brandVars = tenant?.isWhiteLabel ? {
    '--brand-primary':   tenant.brandColor ?? '#000000',
    '--brand-secondary': tenant.brandColorSecondary ?? '#666666',
  } : {};

  // Page title prefix: "Joga FC" vs "Lista"
  const appName = tenant?.isWhiteLabel ? tenant.orgNamePublic : 'Lista';

  return (
    <html style={brandVars}>
      <head>
        {tenant?.isWhiteLabel && tenant.faviconUrl && (
          <link rel="icon" href={tenant.faviconUrl} />
        )}
      </head>
      <body>
        <AppNameContext value={appName}>
          {children}
        </AppNameContext>
      </body>
    </html>
  );
}
```

**What gets replaced on club domains:**

| Element | Default (lista.team) | White-label (club domain) |
|---|---|---|
| Nav logo | Lista wordmark/logo | Club logo (`logo_url`) |
| Favicon | Lista favicon | Club favicon (`favicon_url`) |
| `<title>` tags | `Lista \| Schedule` | `Joga FC \| Schedule` |
| Primary color | Lista blue | `brand_color` |
| Accent color | Lista secondary | `brand_color_secondary` |
| Email from-name | `Lista` | Club name (`org_name_public`) |
| Email footer | "Sent by Lista" | No Lista mention |
| Signup/login pages | Lista branding | Club logo + colors |
| Open Graph / meta | Lista | Club name + logo |

**Tailwind:** Replace hardcoded primary color classes on nav, buttons, and interactive elements with `var(--brand-primary)`. Keep the existing color system for semantic colors (destructive, muted, etc.) — only the primary/accent brand color is swapped.

**Email templates:** Pass `brandName` and `logoUrl` to Resend email templates. When `isWhiteLabel`, omit "Lista" from from-name and footer. Resend supports custom sending domains — club plan includes setup instructions to add a DNS record for `noreply@theirclub.com`.

---

#### 1.8 — Club Admin Portal

New dashboard section visible only to org owners and admins.

**New routes under `src/app/dashboard/club/`:**

```
/dashboard/club                    → Overview: all teams, total members, upcoming events across org
/dashboard/club/teams              → List teams; create new team; archive; reassign coach
/dashboard/club/members            → Cross-team member directory (search, filter by team/role)
/dashboard/club/branding           → Logo upload, colors, subdomain, favicon, display name
/dashboard/club/billing            → Current plan, Stripe portal link, upgrade/downgrade
/dashboard/club/settings           → Org name, contact info, org admin management
```

**Navigation:** The existing `DashboardNav` conditionally renders a "Club" section when the active user has an `organization_members` row for the org that owns their active team. This check happens in the dashboard layout RSC alongside the existing membership fetch.

**Access guard:** Each `/dashboard/club/*` page server component calls `is_org_admin()` via the server Supabase client. Non-admins get a 403 or redirect to `/dashboard`.

**Cross-team data queries:** Club admin pages query teams scoped by `organization_id` rather than `team_id`. Because `is_team_member()` now returns true for org admins, these queries pass RLS automatically — no service role needed for read operations.

---

#### 1.9 — Database Migration Path for Existing Teams

All existing teams already have a 1:1 organization created by `create_team()`. These are effectively throwaway containers today.

**Backfill migration steps:**
1. Add new columns with safe defaults (plan = 'free', subscription_status = 'active')
2. Generate slugs: `regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')`, truncate to 48 chars, deduplicate with `_2`, `_3` suffix
3. Set `created_by` from the first `organization_members` backfill (see §1.2)
4. Insert `organization_members` rows for existing team owners
5. Update `create_team()` RPC to insert into `organization_members`

**User-visible impact:** None. Individual coaches see exactly what they see today. The org structure is invisible to free/pro users.

---

### Phase 2 — Custom Domains

*Subdomains (`slug.lista.team`) remain the default. Custom domains let clubs point their own subdomain at Lista — e.g., `app.jogafc.org` or `teams.jogafc.org` — so members access a fully branded experience on the club's own domain.*

*Clubs already have their own public websites. Lista provides the app experience only — no public-facing pages to build.*

---

#### 2.1 — Domain Shape

Custom domains for Lista clubs will almost always be a **subdomain of the club's existing domain**, not the root domain:

```
app.jogafc.org       → most common
teams.jogafc.org
portal.jogafc.org
```

This is intentional: the club's root domain (`jogafc.org`) already serves their public website. Lista lives at a dedicated subdomain. This is simpler to set up (one CNAME record) and avoids any conflict with the club's existing site.

---

#### 2.2 — Vercel Domain API Integration

**Setup flow:**
1. Club admin enters `app.jogafc.org` in `/dashboard/club/branding`
2. API route `POST /api/club/domain` validates format (must be a subdomain, not bare root domain), then calls Vercel API: `POST /v10/projects/{projectId}/domains`
3. Vercel returns the CNAME target (`cname.vercel-dns.com`)
4. UI shows the single DNS record the club needs to add at their registrar:
   ```
   Type: CNAME
   Name: app
   Value: cname.vercel-dns.com
   ```
5. `GET /api/club/domain/verify` polls Vercel until verified
6. On verified: set `organizations.custom_domain = 'app.jogafc.org'`, invalidate Redis cache
7. Middleware resolves `app.jogafc.org` → tenant via `custom_domain` column

**New API routes:**
```
POST   /api/club/domain         → Register custom domain with Vercel + save to DB
DELETE /api/club/domain         → Remove domain from Vercel + clear from DB
GET    /api/club/domain/verify  → Poll Vercel domain verification status
```

**New env var:** `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`

**Auth cookie note:** Supabase Auth cookies are scoped per origin. Club members on `app.jogafc.org` log in there and get a cookie for that domain — separate from `lista.team`. This is correct and expected behavior. No cross-domain session sharing needed.

---

## Implementation Order

### Sprint 1 — Database Foundation
1. Migration: `organizations` enhancements (slug, plan, brand fields, Stripe fields)
2. Migration: `organization_members` table + RLS policies
3. Migration: new helper functions (`is_org_admin`, `is_org_owner`, `team_org_id`)
4. Migration: update `is_team_member()` and `is_team_admin()` to include org admin check
5. Migration: backfill `organization_members` from existing team owners; generate slugs
6. Update `create_team()` RPC to insert into `organization_members`
7. Update `src/types/database.ts` (regenerate from schema)

### Sprint 2 — Billing
8. Add `stripe` package; configure env vars
9. `POST /api/billing/webhook` — handle subscription lifecycle events
10. `POST /api/billing/create-checkout` — initiate plan upgrade
11. `POST /api/billing/portal` — Stripe Customer Portal redirect
12. `GET /api/billing/status` — return current plan for active org
13. Plan limit enforcement in `create_team()` RPC (free = 1 team)

### Sprint 3 — Tenant Resolution
14. `src/lib/supabase/tenant.ts` — `resolveTenant()` with Upstash Redis caching
15. Middleware changes: call `resolveTenant`, inject `x-tenant-*` headers
16. `getTenantFromHeaders()` helper for server components
17. Cache invalidation on org update (`DELETE tenant:{hostname}` in settings API)

### Sprint 4 — White-Label Theming
18. Root layout: inject CSS brand variables, dynamic favicon, `AppNameContext`
19. Nav: swap Lista logo for club logo on white-label tenants
20. All `<title>` tags: use `appName` from context instead of hardcoded "Lista"
21. Email templates: `brandName` + `logoUrl` params; omit Lista from from-name and footer on white-label
22. Login/signup pages: use club branding when accessed via club subdomain

### Sprint 5 — Club Admin Portal
23. New dashboard routes: `/dashboard/club/*` (all pages in §1.8)
24. Club overview page: cross-org team list, member counts, upcoming events
25. Team management: create team from club portal, archive, reassign coach
26. Member directory: cross-team search with team/role filters
27. Branding settings: logo/favicon upload, color picker, subdomain config, display name
28. Billing page: plan status, Stripe portal link, upgrade CTA
29. Org settings: org name, contact info, manage org admins
30. Nav: conditionally render Club section for org owners/admins
31. Access guard on all `/dashboard/club/*` pages

### Sprint 6 — Subdomain Routing (Live)
32. Configure `*.lista.team` wildcard in Vercel project settings
33. Add subdomain validation/reservation logic to branding settings
34. Middleware enforcement: redirect non-club orgs attempting subdomain access
35. Downgrade flow: clear `subdomain` when subscription cancels

### Sprint 7 — Custom Domains (Phase 2)
36. Add `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID` env vars
37. `POST/DELETE/GET /api/club/domain` routes (with subdomain-only validation)
38. Domain settings UI in `/dashboard/club/branding` (input + DNS instruction card + verification status)
39. Middleware: resolve `custom_domain` column in `resolveTenant()`
40. Cache invalidation on domain add/remove

---

## Key Technical Risks

| Risk | Mitigation |
|---|---|
| **`is_team_member()` performance with org check** | The new org admin check adds a subquery. Add `CREATE INDEX ON organization_members(profile_id, organization_id)` and `CREATE INDEX ON teams(organization_id)`. RLS helpers are `STABLE` — Postgres can cache within a transaction. Monitor query plans after migration. |
| **Tenant lookup latency** | Redis cache (60s TTL) eliminates DB cost for the vast majority of requests. Cold misses hit the DB once. On plan/domain changes, actively delete the cache key. |
| **Free plan slug squatting** | Free/pro orgs should not be able to claim a subdomain. Only set `subdomain` when `plan = 'club'` — enforce in the API route, and add a DB check constraint or trigger. |
| **Subdomain conflicts** | Slugs must be globally unique (`UNIQUE` constraint on `organizations.subdomain`). Reserve `www`, `app`, `api`, `mail`, `admin`, `blog` as blocked values at the API layer. |
| **Auth cookies on custom domains (Phase 2)** | Supabase Auth cookies are scoped per origin. Users on `app.jogafc.org` have a separate session from `lista.team`. This is correct behavior — club members log in on their club's subdomain. No cross-domain session sharing needed. |
| **Stripe webhook idempotency** | Stripe can deliver webhooks more than once. Use `stripe_subscription_id` as an idempotency key and check current state before applying updates. |
| **Email on white-label** | Resend supports custom sending domains. The club setup flow should include a DNS step for `noreply@theirclub.com`. Until configured, fall back to `noreply@lista.team` with club name as from-name. |

---

## Files That Will Change

| File/Directory | Change |
|---|---|
| `supabase/migrations/` | 3–4 new migrations: org enhancements, organization_members, updated helpers, club_pages (Phase 2) |
| `src/types/database.ts` | Regenerate after each migration batch |
| `src/middleware.ts` | Add tenant resolution, header injection, public route allowlist expansion |
| `src/lib/supabase/tenant.ts` | **New** — `resolveTenant()`, `getTenantFromHeaders()`, `TenantContext` type |
| `src/app/layout.tsx` | Brand CSS variables, dynamic favicon, `AppNameContext` |
| `src/app/dashboard/layout.tsx` | Conditionally render Club nav section; pass tenant context |
| `src/app/dashboard/club/` | **New** — all club admin portal pages |
| `src/components/nav/` | Logo swap logic; Club nav section |
| `src/app/api/billing/` | **New** — Stripe checkout, portal, webhook, status |
| `src/app/api/club/` | **New** — org settings, domain management |
| `src/app/api/teams/route.ts` | Add plan limit check (surface 402 on free plan) |
| `apps/web/vercel.json` | No change needed for subdomains (handled in Vercel UI) |
| `apps/web/package.json` | Add `stripe` dependency |
| `apps/web/env.example` | Add Stripe env vars, `VERCEL_API_TOKEN` (Phase 3) |
