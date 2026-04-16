# Multi-Tenant Architecture Spec
*Lista — Individual Teams + White-Label Club Installations*

**Status:** Active — decisions finalized 2026-04-13
**Last updated:** 2026-04-13

---

## Overview

Lista evolves from a single-product app into a **multi-tenant platform** that serves two market segments from a single codebase:

| Segment | Experience | Domain | Pricing |
|---|---|---|---|
| Individual coach/team | Standard Lista app | lista.team | Free |
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
| **Plan tiers** | Free / Club — see table below. |
| **Trial period** | No trial period. Clubs upgrade directly to a paid Club subscription. |
| **Upgrade path** | Via `/dashboard/settings` — a "Plan" section with an "Upgrade to Club" CTA. No mid-flow paywalls. |
| **Public website pages** | Not in scope. Clubs have their own websites. Lista provides the app experience only. |

---

## Plan Tiers

| Plan | Teams | Domain | Branding | Club Admin Portal | Price |
|---|---|---|---|---|---|
| **Free** | Unlimited | lista.team only | Lista branded | No | $0 |
| **Club** | Unlimited | `slug.lista.team` → `app.jogafc.org` (Phase 2) | Full white-label app, zero Lista branding | Yes | ~$199/mo flat |

- Free users use Lista as it exists today — no feature restrictions, no team limits.
- Club is per-organization, billed by the club director. All teams under the org are included.

---

## Architecture Changes

### Phase 1 — Foundation (Multi-Tenancy + Billing)

---

#### 1.1 — Enhance `organizations` Table

**Current state:** `organizations(id, name, created_at)` — RLS is enabled with two permissive policies:

```sql
-- From 20260101000000_initial_schema.sql (lines 150, 153)
create policy "Authenticated users can view organizations"
  on organizations for select using (auth.uid() is not null);

create policy "Authenticated users can insert organizations"
  on organizations for insert with check (auth.uid() is not null);
```

Any authenticated user can read every org and insert new orgs directly. `tests/rls/organizations.test.ts` asserts this behavior in both its test cases.

**What this migration changes:** Both existing policies are **dropped and replaced** with significantly tighter ones. This is a breaking RLS change:

- SELECT narrows from "any authenticated user sees all orgs" → "only members of a team in the org, or org members in `organization_members`"
- INSERT is blocked for direct client calls entirely → org creation is only permitted via the `create_team()` RPC (which uses the service role)
- UPDATE and DELETE policies are new (currently no UPDATE/DELETE policies exist, so those operations fall through to the default-deny)

**Migration must include:**
```sql
DROP POLICY "Authenticated users can view organizations" ON organizations;
DROP POLICY "Authenticated users can insert organizations" ON organizations;
-- Then create the new policies as described below
```

**`tests/rls/organizations.test.ts` must be updated** alongside this migration — both existing tests will fail after the policy change:
- The INSERT test inserts directly via the client; it must be rewritten to assert that direct insert is now rejected (403), with a separate test verifying insert succeeds via `create_team()` RPC
- The SELECT test must be rewritten to verify the membership-scoped visibility: a user can see their own org but not an unrelated org created by a different user

```sql
-- Migration: YYYYMMDDNNNNNN_organization_enhancements.sql

-- slug must be added nullable first, backfilled, then constrained.
-- Adding UNIQUE before backfill would immediately fail on existing rows.
ALTER TABLE organizations ADD COLUMN slug text;
-- Backfill: slugify org name, lowercase, deduplicate with _2/_3 suffix
UPDATE organizations
SET slug = (
  SELECT LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g'))
  || CASE WHEN ROW_NUMBER() OVER (
       PARTITION BY LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g'))
       ORDER BY created_at
     ) = 1 THEN '' ELSE '_' || (ROW_NUMBER() OVER (
       PARTITION BY LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g'))
       ORDER BY created_at
     ))::text END
  FROM organizations o2 WHERE o2.id = organizations.id
);
ALTER TABLE organizations ALTER COLUMN slug SET NOT NULL;
ALTER TABLE organizations ADD CONSTRAINT organizations_slug_key UNIQUE (slug);
ALTER TABLE organizations ADD COLUMN plan         text NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free', 'club'));
ALTER TABLE organizations ADD COLUMN subdomain    text UNIQUE; -- 'jogafc' → jogafc.lista.team
-- custom_domain reserved for Phase 2 (custom domains)
ALTER TABLE organizations ADD COLUMN custom_domain text UNIQUE;
ALTER TABLE organizations ADD COLUMN brand_color  text;        -- hex e.g. '#1a2f5e'
ALTER TABLE organizations ADD COLUMN brand_color_secondary text;
ALTER TABLE organizations ADD COLUMN logo_url     text;
ALTER TABLE organizations ADD COLUMN favicon_url  text;
ALTER TABLE organizations ADD COLUMN org_name_public text;     -- display name used in white-label UI
ALTER TABLE organizations ADD COLUMN stripe_customer_id       text;
ALTER TABLE organizations ADD COLUMN stripe_subscription_id   text;
ALTER TABLE organizations ADD COLUMN subscription_status text
  CHECK (subscription_status IN ('active', 'past_due', 'canceled'));
  -- NULL for free orgs with no subscription
ALTER TABLE organizations ADD COLUMN created_by   uuid REFERENCES profiles(id);
```

**Backfill:** Generate slugs from existing `organizations.name` (slugify, lowercase, deduplicate with numeric suffix). Set `created_by` from the team owner where discoverable.

**RLS policies for `organizations`:**
- `SELECT`: profile is a member of any team in the org, OR is an org member
- `UPDATE`: `is_org_admin(id)` — only org owners/admins can update branding, settings
- `INSERT`: **no permissive client INSERT policy** — direct inserts from the client are blocked by default-deny. Org creation is only permitted via the `create_team()` RPC, which runs with the service role and therefore bypasses RLS.
- `DELETE`: `is_org_owner(id)` only

---

#### 1.2 — `organization_members` Table + Director Role

New table establishing org-level roles. The two roles here are **`owner`** (the club's primary account holder, responsible for billing) and **`director`** (a club administrator with full team management authority). Both are collectively referred to as "directors" in the product UI — the distinction only matters for billing access.

```sql
-- Migration: YYYYMMDDNNNNNN_organization_members.sql

CREATE TABLE organization_members (
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id      uuid REFERENCES profiles(id)      ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('owner', 'director')),
  created_at      timestamptz DEFAULT now(),
  PRIMARY KEY (organization_id, profile_id)
);

-- Enforce exactly one owner per org at the database level.
-- Without this, the backfill and future ownership transfers could silently
-- produce multiple owner rows, making billing authority ambiguous.
CREATE UNIQUE INDEX organization_members_one_owner
  ON organization_members (organization_id)
  WHERE role = 'owner';

-- RLS
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER helper to fetch the org IDs the current user belongs to,
-- bypassing RLS so the organization_members SELECT policy below does not
-- self-reference its own table and trigger infinite recursion.
CREATE OR REPLACE FUNCTION get_user_org_ids() RETURNS SETOF uuid AS $$
  SELECT organization_id FROM organization_members om
  JOIN profiles p ON p.id = om.profile_id
  WHERE p.auth_user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Any org member (owner or director) can see the full org_members list.
-- Uses get_user_org_ids() rather than inline SQL against organization_members
-- to avoid infinite recursion: a direct sub-query on the same table re-enters
-- this policy, whereas a SECURITY DEFINER function bypasses RLS entirely.
CREATE POLICY "org members can view org_members"
  ON organization_members FOR SELECT
  USING (
    profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
    OR organization_id IN (SELECT get_user_org_ids())
  );

-- Only org owners can manage org membership (add/remove directors)
CREATE POLICY "org owners can manage org_members"
  ON organization_members FOR ALL
  USING (is_org_owner(organization_id))
  WITH CHECK (is_org_owner(organization_id));
```

**Role definitions:**
- `owner`: full control — billing, branding, subdomain, creating teams, inviting directors. Exactly one per org (enforced by the partial unique index above; ownership transfer must delete the old row before inserting the new one, or use an UPDATE).
- `director`: can create teams, manage all teams in the org, invite members. No billing access.

**`director` in `team_members`:** Directors also appear in `team_members` with a new `director` role. This is how they get team-level visibility and chat access for teams they create. See §1.3 for the role addition and §1.4 for auto-enrollment on team creation.

**Backfill:** Insert one `organization_members` row (`role = 'owner'`) per organization, using the `owner_id` of the team with the earliest `created_at` in that org. Because `create_team()` today always creates a new org atomically, every existing org should have exactly one team and one owner — but the migration must be defensive. Use `INSERT ... ON CONFLICT DO NOTHING` (the partial unique index on `(organization_id) WHERE role = 'owner'` will reject any duplicate), so if a org somehow has multiple teams with different owners, the earliest team's owner wins and the rest are silently skipped. After migration, review any orgs that had conflicts and resolve ownership manually if needed. Existing free-user orgs are unaffected functionally — the owner entry is a record-keeping row; no UI change for them.

**Update `create_team()` RPC:** After creating the org and team, also insert into `organization_members` with `role = 'owner'`. See §1.4 for the separate club team creation path.

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
      AND om.role IN ('owner', 'director')
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

**Add `director` to `team_members.role`:**

```sql
ALTER TABLE team_members DROP CONSTRAINT team_members_role_check;
ALTER TABLE team_members ADD CONSTRAINT team_members_role_check
  CHECK (role IN ('coach', 'manager', 'parent', 'player', 'director'));
```

Directors appear in `team_members` with role `director` for every team they create. This gives them first-class team membership — they appear in the team roster, can participate in team chat, and receive team notifications through the existing member-scoped systems.

**Modify existing helpers to include `director` and org-level access:**

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
  -- Directors have implicit membership access to all teams in their org,
  -- covering teams they didn't directly create (no team_members row yet)
  OR is_org_admin(team_org_id(t_id));
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Replace existing is_team_admin()
CREATE OR REPLACE FUNCTION is_team_admin(t_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members tm
    JOIN profiles p ON p.id = tm.profile_id
    WHERE tm.team_id = t_id
      AND p.auth_user_id = auth.uid()
      AND tm.role IN ('coach', 'manager', 'director')
  )
  -- Directors have implicit admin access to all teams in their org
  OR is_org_admin(team_org_id(t_id));
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

**Impact:** Because every existing RLS policy on team-scoped tables already goes through `is_team_member()` or `is_team_admin()`, these changes grant directors full cross-team read/write access with no additional policy changes. All existing policies on `events`, `availability`, `team_members`, `channels`, `messages`, `locations`, `invitations` etc. pick it up automatically.

**Server-side authorization — directors without an explicit `team_members` row:**

RLS policies are enforced automatically at the database layer, so Supabase queries on team-scoped tables already respect director access via the updated `is_team_member()` and `is_team_admin()` helpers. However, many server routes and Server Actions perform their own authorization check against `team_members` directly — before the query reaches RLS — to decide whether to proceed. A director who has no explicit row on a team will fail these pre-checks even though the underlying RLS would permit the operation.

**Any route or action that currently gates a mutation by checking for a direct `team_members` row must be updated to also accept org-level director status.** The pattern is:

```typescript
// Current pattern — blocks directors with no team_members row
const { data: membership } = await admin
  .from('team_members')
  .select('role')
  .eq('team_id', teamId)
  .eq('profile_id', user.id)
  .single();

if (!membership || !['coach', 'manager'].includes(membership.role)) {
  return unauthorized();
}

// Updated pattern — org-aware
const { data: membership } = await admin
  .from('team_members')
  .select('role')
  .eq('team_id', teamId)
  .eq('profile_id', user.id)
  .maybeSingle();

const isTeamAdmin = membership && ['coach', 'manager', 'director'].includes(membership.role);

const { data: team } = await admin
  .from('teams')
  .select('organization_id')
  .eq('id', teamId)
  .single();

const { data: orgMembership } = await admin
  .from('organization_members')
  .select('role')
  .eq('organization_id', team.organization_id)
  .eq('profile_id', user.id)
  .maybeSingle();

const isOrgDirector = ['owner', 'director'].includes(orgMembership?.role ?? '');

if (!isTeamAdmin && !isOrgDirector) return unauthorized();
```

This pattern should be extracted into a shared helper (e.g. `src/lib/api-auth.ts` `assertTeamAdmin(teamId, userId)`) to avoid duplication across routes. Before shipping the club portal (Sprint 5), audit every route and Server Action that performs a `team_members` role check and apply this pattern. Known sites already identified in this spec: `/api/invitations/[id]/resend` and `/api/account/transfer-ownership`. Others may exist.

**Client-side role checks — `director` must be treated as admin:**

RLS alone is not enough. Several UI affordances are derived from `membership.role` client-side rather than from RLS, so a director with an explicit `team_members` row would see a read-only experience without these changes.

The following client-side checks must include `director`:

| Location | Current check | Updated check |
|---|---|---|
| `src/app/dashboard/settings/page.tsx` line 41 | `role === "coach" \|\| role === "manager"` | `role === "coach" \|\| role === "manager" \|\| role === "director"` |

Any other place in the codebase that derives admin/edit affordances from `membership.role` should apply the same extension. Run a search for `=== "coach"` and `=== "manager"` in role comparison contexts before shipping Sprint 5 to catch any additional sites.

**`isOwner` and ownership transfer:**

The `isOwner` flag (`teams.owner_id === user.id`) controls the ownership transfer UI in the team settings page. Directors do **not** get `isOwner = true` in the team settings — ownership transfer for club teams is handled from the club portal (`/dashboard/club/teams`). This avoids two competing UIs for the same operation.

However, directors with an explicit `team_members` row **are** eligible to receive ownership of a team. The `eligibleAdmins` query in `settings/page.tsx` (line 58) currently filters to `role IN ("coach", "manager")` — update this to `role IN ("coach", "manager", "director")` so directors appear as transfer candidates when an owner initiates a transfer.

**Chat access scope for directors:**

The `channels` table uses two different RLS patterns:
- **Default team channel** (type `team`): gated by `is_team_member()` — directors get access automatically via the org admin check.
- **Group channels** (type `group`): gated by `is_channel_member()`, which checks for an explicit row in `channel_members`. This helper is **not modified**. Directors are not auto-enrolled in group channels and cannot read them unless explicitly invited — this is intentional. Group channels are team-internal spaces (e.g. "Defenders only"); a director browsing across many teams should not have automatic visibility into all of them.

DM channels are scoped to `profile_a = auth.uid() OR profile_b = auth.uid()` — directors cannot read DMs they are not party to, regardless of org membership.

---

#### 1.4 — Team Creation: Two Paths

Team creation now has two distinct paths depending on context.

**Path A — Free user creates a standalone team (unchanged):**
- Caller: any authenticated user
- Behavior: `create_team()` RPC creates a new org + team atomically, adds the creator to `team_members` as `coach` and to `organization_members` as `owner`
- No change from today

**Path B — Club director creates a team within an existing org:**
- Caller: must be `owner` or `director` in `organization_members` for the target org (enforced in the RPC; raises `insufficient_privilege` otherwise)
- New RPC: `create_club_team(org_id uuid, team_name text, season text)` — does NOT create a new org
- On success: inserts into `teams` (with the given `org_id`, and `owner_id` set to the caller's profile ID), adds the caller to `team_members` as `director`, updates `profiles.active_team_id` to the new team
- `owner_id` is the caller at creation time. Ownership can be transferred later by any org director via the club portal (`/dashboard/club/teams`). The `isOwner` flag in the team settings page is intentionally suppressed for directors (see §1.3) — ownership transfer for club teams surfaces in the club portal only, not the per-team settings page.
- Other directors in the org are **not** auto-enrolled in `team_members` for the new team — they gain access via the `is_org_admin()` check in `is_team_member()`. Only the creating director gets an explicit row.

**Why explicit row for creator only:** An explicit `team_members` row for the creating director ensures they appear in the team roster, receive team notifications, and have access to team chat. Other directors can view and manage the team via RLS but won't appear in the roster or receive notifications until they're explicitly added — which is the correct default for a club with many teams.

**Restricting team creation in a club:** The existing `/api/teams` route calls `create_team()` and is available to all users. A new `/api/club/teams` route (POST) will call `create_club_team()` instead. The club admin portal's "Create team" button calls this new route. There is no UI in the standard dashboard for a free user to create a team under an existing club org.

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

**Upgrade entry point:** Free users discover the Club plan through the settings page (`/dashboard/settings`), which gains a "Plan" section showing their current plan and an "Upgrade to Club" CTA. This is the only upgrade path — no paywalls blocking features mid-flow, no inline upsell prompts.

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
| `checkout.session.completed` | Set `stripe_subscription_id`, update `plan = 'club'`, set `subscription_status = 'active'` |
| `invoice.payment_succeeded` | Set `subscription_status = 'active'` |
| `invoice.payment_failed` | Set `subscription_status = 'past_due'` |
| `customer.subscription.deleted` | Set `plan = 'free'`, `subscription_status = 'canceled'`, clear `subdomain` and `custom_domain` |

**Downgrade to free:** When a Club subscription cancels, set `plan = 'free'`, clear `subdomain` and `custom_domain` — the club's `slug.lista.team` stops resolving and redirects to `lista.team`. Teams within the org are not deleted; the org owner retains access to all teams via lista.team as a regular free user.

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
                            (Phase 2 only — ignored until then)
```

**New file: `src/lib/supabase/tenant.ts`**

```typescript
export type TenantContext = {
  organizationId: string;
  slug: string;
  plan: 'free' | 'club';
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
/dashboard/club/teams              → List teams; create new team; transfer team ownership; archive
/dashboard/club/members            → Cross-team member directory (search, filter by team/role)
/dashboard/club/branding           → Logo upload, colors, subdomain, favicon, display name
/dashboard/club/billing            → Subscription status, invoices, Stripe portal link, cancel
/dashboard/club/settings           → Org name, contact info, director management
```

**Team archiving:** A director can mark a team as archived from `/dashboard/club/teams`. This requires a new `archived_at timestamptz` column on `teams`.

The key enforcement mechanism is updating both RLS helpers to return `false` for non-org-admins on archived teams. Because `getActiveMembership` (`src/lib/get-active-membership.ts`), the dashboard layout (`src/app/dashboard/layout.tsx` line 80), and the mobile `AppContext` (`apps/mobile/contexts/AppContext.tsx` line 179) all resolve the active team by querying `team_members` — which is RLS-gated — this single change propagates correctly to all three sites without touching those files.

**`is_team_member()` update:**
```sql
CREATE OR REPLACE FUNCTION is_team_member(t_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members tm
    JOIN profiles p ON p.id = tm.profile_id
    -- Exclude archived teams for regular members
    JOIN teams t ON t.id = tm.team_id AND (t.archived_at IS NULL OR is_org_admin(t.organization_id))
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
  OR is_org_admin(team_org_id(t_id));
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

**`is_team_admin()` update:** Apply the same `archived_at` guard — non-org-admins should not have write access to archived teams:
```sql
CREATE OR REPLACE FUNCTION is_team_admin(t_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members tm
    JOIN profiles p ON p.id = tm.profile_id
    JOIN teams t ON t.id = tm.team_id AND (t.archived_at IS NULL OR is_org_admin(t.organization_id))
    WHERE tm.team_id = t_id
      AND p.auth_user_id = auth.uid()
      AND tm.role IN ('coach', 'manager', 'director')
  )
  OR is_org_admin(team_org_id(t_id));
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

**Downstream effects of the RLS change:**
- `getActiveMembership()`: if `profiles.active_team_id` points to an archived team, the `team_members` query returns null (RLS excludes the row), and the function falls through to the earliest non-archived membership. Correct behavior without any code change.
- `dashboard/layout.tsx` `allMemberships` query: archived teams are excluded from the result set by RLS. The team switcher, which is derived from `allMemberships`, naturally excludes archived teams.
- `AppContext.tsx` `allMemberships`: same — archived teams are filtered out by RLS, so `membership` fallback chains (`allMemberships[0]`) never resolve to an archived team.

**`profiles.active_team_id` stale reference:** When a team is archived, proactively clear `active_team_id` for all profiles that currently point to it:
```sql
UPDATE profiles SET active_team_id = NULL WHERE active_team_id = :archived_team_id;
```
This avoids the `getActiveMembership` fallback path being hit unnecessarily on every page load for affected users.

**Remaining behavior of archived teams:**
- Fully readable by org directors (org admin check in RLS helpers still returns true)
- Cannot have new events, members, or chat messages added — enforced at the API layer by checking `teams.archived_at IS NOT NULL` before mutating operations
- Hidden from the club overview count and team switcher by default; filterable via "Show archived" in `/dashboard/club/teams`
- Can be unarchived by a director

**Team ownership transfer:** Directors can transfer a team's `owner_id` to any coach, manager, or director on that team via the club portal. This requires backend changes — the existing transfer paths both hard-reject callers who are not the current `owner_id` holder.

There are two transfer code paths that must both be updated:

*1. Server action — `src/app/actions/team.ts` `transferOwnership()` (line 223):*

```typescript
// Current — blocks anyone who is not the current owner
if (teamRow.owner_id !== user.id) return { error: "Not authorized" };

// Updated — also allow org directors
const callerIsOwner = teamRow.owner_id === user.id;
const { data: orgMembership } = await admin
  .from('organization_members')
  .select('role')
  .eq('organization_id', teamRow.organization_id)
  .eq('profile_id', user.id)   // user.id == profile.id for auth-backed users
  .maybeSingle();
const callerIsDirector = ['owner', 'director'].includes(orgMembership?.role ?? '');

if (!callerIsOwner && !callerIsDirector) return { error: "Not authorized" };
```

*2. API route — `src/app/api/account/transfer-ownership/route.ts` (line 63):*

Same authorization expansion. The route also needs `organization_id` from the team row, so update the initial team select:

```typescript
// Current
.select("owner_id")

// Updated
.select("owner_id, organization_id")
```

Then apply the same `callerIsOwner || callerIsDirector` check before proceeding.

*3. Recipient eligibility — both paths (lines 79 and 240):*

The recipient role check currently limits to `coach` and `manager`. Directors with an explicit `team_members` row are also eligible to receive ownership:

```typescript
// Current
if (!["coach", "manager"].includes(recipientMembership.role)) { ... }

// Updated
if (!["coach", "manager", "director"].includes(recipientMembership.role)) { ... }
```

**Relationship between `teams.owner_id` and `organization_members`:**

These are independent. A director transferring a team's `owner_id` to a coach does not change org-level ownership in `organization_members`. The org owner remains the org owner; the team just has a new individual owner for that team. This is the correct behavior — org-level director status is managed separately through the club portal's director management UI.

**Upgrade entry point:** Free users access `/dashboard/settings` which shows a "Plan" section with their current plan (Free) and an "Upgrade to Club" CTA. Club owners access `/dashboard/club/billing` for subscription management post-upgrade. The settings plan section for Club owners links through to `/dashboard/club/billing`.

**Division of responsibility between team settings and club portal:**

Directors with an explicit `team_members` row on a team see the standard team dashboard and settings page with full admin affordances (same as a coach/manager — see §1.3). This means they can edit team details, manage members, create events, etc. from the ordinary team UI they're already familiar with.

The club portal (`/dashboard/club/*`) handles org-level concerns that don't exist in the per-team UI: creating new teams, archiving teams, cross-team member directory, branding, billing, and ownership transfer. Directors do not need the club portal to do day-to-day management of a specific team.

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
4. Insert one `organization_members` row (`role = 'owner'`) per org using the earliest team's `owner_id`; use `ON CONFLICT DO NOTHING` to handle any pre-existing multi-team orgs defensively
5. Update `create_team()` RPC to insert into `organization_members`

**User-visible impact:** None. Individual coaches see exactly what they see today. The org structure is invisible to free users.

**Invite flow — host context end-to-end:**

The invite flow has multiple surfaces. Some are already host-preserving; others need explicit changes for white-label tenants.

**Already host-preserving (no changes needed):**
- `src/app/auth/callback/route.ts` — derives `origin` from `new URL(request.url)`, so redirects land on whichever host the callback was received on. Works correctly for both `jogafc.lista.team` and (Phase 2) `app.jogafc.org` without modification.
- All relative links and `router.push()` calls within the invite page components (`/invite/[id]`, `/invite/[id]/signup`, `/invite/[id]/login`) — stay on the current host automatically.

**Changes required:**

*1. Invite URL base — `/api/invitations/send` (line 115) and `/api/invitations/[id]/resend` (line 60):*

Both routes compute `appUrl` from `NEXT_PUBLIC_APP_URL`. For Club-plan teams the base must use the org's subdomain (or custom domain in Phase 2). Both routes must resolve the team's org before constructing the URL:

```typescript
// Shared helper: src/lib/invitations/invite-base-url.ts
export async function inviteBaseUrl(teamId: string): Promise<string> {
  const { data: org } = await admin
    .from('organizations')
    .select('plan, subdomain, custom_domain')
    .eq('id', /* team's organization_id */)
    .single();

  if (org?.plan === 'club') {
    if (org.custom_domain) return `https://${org.custom_domain}`;       // Phase 2
    if (org.subdomain)     return `https://${org.subdomain}.lista.team`;
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://lista.team';
}
```

*2. Email branding — `src/lib/notifications/email.ts` `buildInviteEmailHtml`:*

The function currently hardcodes Lista identity in four places:
- Email subject (passed by caller): `"You've been invited to join ${teamName} on Lista"` — callers must conditionally omit "on Lista" for white-label
- Logo block (line 364): hardcoded `"lista"` text
- Heading (line 374): `"join a team on Lista!"`
- Body copy (line 384): `"is using Lista to organize"`

Update `buildInviteEmailHtml` signature to accept optional branding:

```typescript
buildInviteEmailHtml({
  teamName,
  inviterName,
  role,
  inviteUrl,
  brandName,   // 'Joga FC' for white-label, 'Lista' for default
  logoUrl,     // club logo URL or null
})
```

Both send routes must fetch `org.org_name_public` and `org.logo_url` alongside the team name query and pass them through.

*3. Invite signup form branding — `src/components/invite/invite-signup-form.tsx` (line 94):*

The `CardTitle` hardcodes `"lista"`. The invite signup page is served on the club's subdomain and must show the club's name. Pass `brandName` as a prop from the server component (`/invite/[id]/signup/page.tsx`), which can read it from the tenant context headers.

*4. Director role missing from resend authorization — `/api/invitations/[id]/resend` (line 47):*

```typescript
// Current — blocks directors
if (!membership || !["coach", "manager"].includes(membership.role)) {

// Fixed
if (!membership || !["coach", "manager", "director"].includes(membership.role)) {
```

This is a correctness bug independent of white-labeling and should be fixed in Sprint 1 alongside the role additions.

**Phase 2 extension (custom domains):** The `inviteBaseUrl` helper above already handles `custom_domain` when set — no further invite-flow changes needed when Phase 2 lands. The `auth/callback` redirect is already origin-aware and works correctly on any custom domain without modification.

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

### Phase 3 — Custom Club Mobile Apps

*Club-plan tenants can have a fully branded iOS app (and Android — see note below) published under their club's identity. Parents are told "download the Joga FC app" and find a club-branded app in the App Store — no visible connection to Lista.*

*This is not self-serve on day one. Each new club app requires a build + App Store submission cycle (1–3 days for Apple review). The setup process is streamlined via tooling but initiated by you (Jared), not automatically by the club.*

---

#### 3.1 — Android Scope

iOS only for now. Android is deferred to a future phase. The EAS build pipeline and parameterized `app.config.js` will support Android with minimal additional work when the time comes — the `android.package` field just needs to be set alongside `ios.bundleIdentifier`.

---

#### 3.2 — What Changes Per Club App

Each club app is a distinct binary with:

| Property | Example |
|---|---|
| App name (App Store) | `Joga FC` |
| Bundle ID / Application ID | `org.jogafc.app` |
| App icon | Club logo (1024×1024 PNG) |
| Splash screen | Club logo + primary color background |
| Primary color | `#1a2f5e` |
| Hardcoded org ID | `uuid-of-jogafc-org` |

Functionally the app is identical to the standard Lista mobile app — same screens, same API calls, same Supabase backend. Branding and tenant identity are the only differences.

---

#### 3.3 — New `organizations` Columns for Mobile

```sql
-- Migration: YYYYMMDDNNNNNN_organization_mobile.sql

ALTER TABLE organizations ADD COLUMN app_name         text;   -- 'Joga FC'
ALTER TABLE organizations ADD COLUMN app_bundle_id    text UNIQUE; -- 'org.jogafc.app'
ALTER TABLE organizations ADD COLUMN app_icon_url     text;   -- Supabase Storage URL (1024×1024 PNG)
ALTER TABLE organizations ADD COLUMN expo_project_id  text UNIQUE; -- Expo project for this club's app
ALTER TABLE organizations ADD COLUMN app_store_id     text;   -- Apple App Store ID (populated post-publish)
```

---

#### 3.4 — EAS Build Pipeline

The `apps/mobile/` Expo app is parameterized so a single codebase produces any club's binary.

**`apps/mobile/app.config.js` (updated):**

```javascript
export default ({ config }) => {
  const orgId        = process.env.EXPO_PUBLIC_ORG_ID;
  const appName      = process.env.EXPO_APP_NAME      ?? 'Lista';
  const bundleId     = process.env.EXPO_BUNDLE_ID     ?? 'team.lista.app';
  const subdomain    = process.env.EXPO_SUBDOMAIN;    // e.g. 'jogafc' → jogafc.lista.team
  const customDomain = process.env.EXPO_CUSTOM_DOMAIN; // Phase 2: e.g. 'app.jogafc.org'

  // Determine the hostname this app handles universal links for.
  // Priority: custom domain (Phase 2) > subdomain > default lista.team
  const appHost = customDomain ?? (subdomain ? `${subdomain}.lista.team` : 'lista.team');

  return {
    ...config,
    name: appName,
    slug: bundleId.replace(/\./g, '-'),
    ios: {
      bundleIdentifier: bundleId,
      associatedDomains: [`applinks:${appHost}`],
      // ...
    },
    extra: { orgId },   // accessible at runtime via Constants.expoConfig.extra.orgId
  };
};
```

**`apps/mobile/eas.json` (updated):**

Each club gets a named build profile:

```json
{
  "build": {
    "lista-production": { ... },
    "jogafc-production": {
      "extends": "lista-production",
      "env": {
        "EXPO_PUBLIC_ORG_ID": "uuid-of-jogafc-org",
        "EXPO_APP_NAME": "Joga FC",
        "EXPO_BUNDLE_ID": "org.jogafc.app",
        "EXPO_SUBDOMAIN": "jogafc",
        "EXPO_CUSTOM_DOMAIN": ""
      }
    }
  }
}
```

**Build script `scripts/build-club-app.sh`:**

A thin wrapper that:
1. Accepts `--org-id`, `--app-name`, `--bundle-id`, `--subdomain`, `--custom-domain` (optional, Phase 2), `--platform` args
2. Creates or updates the EAS build profile in `eas.json`
3. Creates the Expo project via Expo API if `expo_project_id` doesn't exist yet
4. Runs `eas build --profile {club}-production --platform {ios|android}`
5. Outputs the build artifact URL for App Store submission

---

#### 3.5 — Tenant Resolution in the Mobile App

Unlike the web app (hostname-based), the mobile app uses the hardcoded org ID from the build config:

```typescript
// apps/mobile/src/lib/tenant.ts
import Constants from 'expo-constants';

export const ORG_ID: string | null = Constants.expoConfig?.extra?.orgId ?? null;

// If ORG_ID is null, the app is the standard Lista app (no white-label)
export const isWhiteLabel = ORG_ID !== null;
```

The Supabase client and all API calls use `ORG_ID` to scope org-level queries. Team access is still RLS-enforced — the org ID just determines which org's branding and teams are surfaced in the UI.

**Branding at runtime:** On first load (or on login), the app fetches the org's branding from:

```
GET /api/mobile/tenant?orgId={ORG_ID}
→ { appName, brandColor, brandColorSecondary, logoUrl }
```

This allows logo/color updates without a new binary. App name and icon still require a new build (App Store constraint).

---

#### 3.6 — Push Notifications Per Club App

This is the most complex part of custom mobile apps. Each club app has a different bundle ID, which means different APNs credentials.

**How Expo handles this:** Each Expo project has its own APNs credentials configured in EAS. When a user's device registers for push on the club app, the token is associated with that Expo project's APNs certificate. Sending a notification to that token must go through the same Expo project — not the standard Lista Expo project.

**Required changes to `push_subscriptions` table:**

```sql
ALTER TABLE push_subscriptions ADD COLUMN expo_project_id text;
-- NULL = standard Lista app; non-null = club-specific Expo project
```

**Required changes to the notification send logic (`/api/notifications/send` and `/api/chat/notify`):**

When fanning out push notifications, group tokens by `expo_project_id`. For each group, send via the Expo push API using the access token for that project (stored as a secret, not in the DB):

```typescript
// Pseudocode
const byProject = groupBy(subscriptions, s => s.expo_project_id ?? 'lista-default');
for (const [projectId, tokens] of Object.entries(byProject)) {
  const expoClient = new Expo({ accessToken: getExpoToken(projectId) });
  await expoClient.sendPushNotificationsAsync(tokens.map(t => ({ to: t.expo_push_token, ... })));
}
```

**Expo project access tokens** are stored as environment variables, keyed by project ID:
```
EXPO_TOKEN_LISTA=...
EXPO_TOKEN_JOGAFC=...
```

New clubs require adding a new env var on Vercel. This is a manual step in the club setup process.

---

#### 3.7 — Deep Linking for Invitations

Invite links generated for teams in a club org should open the club's app, not the standard Lista app. This requires universal links configured per club app.

**`apps/mobile/app.config.js`** includes the associated domains via the `appHost` value derived from `EXPO_SUBDOMAIN` / `EXPO_CUSTOM_DOMAIN` (see §3.4 for the full config — the `associatedDomains` field is defined there). Each club build passes its subdomain via `EXPO_SUBDOMAIN` in `eas.json` and the build script, so `appHost` resolves to the correct hostname at build time without any runtime lookup.

**Invite URL generation (backend):** When generating invite links for a team that belongs to a Club-plan org with a subdomain, use the org's subdomain as the base URL:

```typescript
const baseUrl = org.plan === 'club' && org.subdomain
  ? `https://${org.subdomain}.lista.team`
  : process.env.NEXT_PUBLIC_APP_URL;
const inviteUrl = `${baseUrl}/invite/${invitation.id}`;
```

This means the invite link opens on the club's web subdomain. Universal links on the club's app are configured for that subdomain, so iOS will intercept the link and open the club app instead of the browser.

---

#### 3.8 — Club App Setup Process (Manual)

When a Club-plan customer wants their own app:

1. **Club provides:** app name, icon (1024×1024 PNG), primary color, desired bundle ID
2. **You:** upload icon to Supabase Storage, update `organizations` record with `app_name`, `app_bundle_id`, `app_icon_url`
3. **You:** create a new Expo project via `eas init` or Expo dashboard, save `expo_project_id` to the org record
4. **You:** run `scripts/build-club-app.sh --org-id {uuid} --app-name "Joga FC" --bundle-id org.jogafc.app`
5. **App Store submission:** submit the build to App Store Connect under Lista's Apple Developer account
6. **Apple review:** 1–3 days
7. **Post-approval:** save `app_store_id` to the org record; configure universal links on the subdomain
8. **Add Expo access token** as `EXPO_TOKEN_{SLUG}` env var in Vercel

**Tooling goal:** steps 2–4 should eventually be scriptable into a single `pnpm club:setup-app --org-id {uuid}` command.

---

#### 3.9 — Apple Developer Account Ownership

All club apps are published under the **Lista Apple Developer account**. The App Store listing publisher name will be Lista's entity name, though the app name itself will be the club's (e.g. "Joga FC").

Implications:
- One Apple Developer Program membership ($99/yr) covers all club apps — no per-club cost
- Simpler credential management — one set of certificates, one team ID in EAS
- If a club ever wants to migrate to their own account in the future, Apple does not support transferring apps between developer accounts; they would need a new App Store listing (new reviews, loss of ratings/reviews)
- Clubs should be made aware at onboarding that the app is published under Lista's account

---

## Implementation Order

### Sprint 1 — Database Foundation
1. Migration: `organizations` enhancements (slug, plan, brand fields, Stripe fields)
2. Migration: `organization_members` table (`owner`/`director` roles) + RLS policies
3. Migration: add `director` to `team_members.role` CHECK constraint
4. Migration: new helper functions (`is_org_admin`, `is_org_owner`, `team_org_id`)
5. Migration: update `is_team_member()` and `is_team_admin()` to include `director` role and org-level check
6. Migration: backfill `organization_members` from existing team owners; generate org slugs
7. Update `create_team()` RPC to also insert into `organization_members` as `owner`
8. New `create_club_team(org_id, team_name, season)` RPC — club-scoped team creation, caller enrolled as `director`
9. Migration: add `archived_at timestamptz` to `teams`; update `is_team_member()` to exclude archived teams for non-org-admins
10. Fix `/api/invitations/[id]/resend` role check: add `director` to allowed roles (correctness bug, independent of white-labeling)
11. Update `src/types/database.ts` (regenerate from schema)

### Sprint 2 — Billing
8. Add `stripe` package; configure env vars
9. `POST /api/billing/webhook` — handle subscription lifecycle events
10. `POST /api/billing/create-checkout` — initiate plan upgrade
11. `POST /api/billing/portal` — Stripe Customer Portal redirect
12. `GET /api/billing/status` — return current plan for active org
13. No team-count limits to enforce for free users — remove any existing guards if present

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
25. Team management: create team via `POST /api/club/teams` → `create_club_team()` RPC; archive (`archived_at`); transfer ownership (surfaces existing `/api/account/transfer-ownership`)
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

### Sprint 8 — Custom Mobile Apps (Phase 3)
41. Migration: `app_name`, `app_bundle_id`, `app_icon_url`, `expo_project_id`, `app_store_id` columns on `organizations`
42. Migration: `expo_project_id` column on `push_subscriptions`
43. Parameterize `apps/mobile/app.config.js` with `EXPO_PUBLIC_ORG_ID`, `EXPO_APP_NAME`, `EXPO_BUNDLE_ID`
44. `GET /api/mobile/tenant` — returns branding for a given org ID (no auth required)
45. Update notification fan-out (`/api/notifications/send`, `/api/chat/notify`) to group tokens by `expo_project_id` and send via the correct Expo project token
46. `scripts/build-club-app.sh` — parameterized EAS build script (iOS only; Lista Apple Developer account)
47. Universal links: update `app.config.js` to set `associatedDomains` from subdomain
48. Invite URL generation: use org subdomain as base URL for Club-plan orgs
49. Document club app setup runbook (manual steps 1–8 from §3.8)

---

## Key Technical Risks

| Risk | Mitigation |
|---|---|
| **Local development — subdomain routing** | `*.lista.team` wildcard does not resolve on `localhost`. To test tenant routing locally, add entries to `/etc/hosts`: `127.0.0.1 jogafc.lista.team`. Alternatively, add a `TENANT_OVERRIDE_HOSTNAME` env var that `resolveTenant()` reads instead of the real hostname when set — useful for dev without modifying hosts file. |
| **`is_team_member()` performance with org check** | The new org admin check adds a subquery. Add `CREATE INDEX ON organization_members(profile_id, organization_id)` and `CREATE INDEX ON teams(organization_id)`. RLS helpers are `STABLE` — Postgres can cache within a transaction. Monitor query plans after migration. |
| **Tenant lookup latency** | Redis cache (60s TTL) eliminates DB cost for the vast majority of requests. Cold misses hit the DB once. On plan/domain changes, actively delete the cache key. |
| **Free plan slug squatting** | Free orgs should not be able to claim a subdomain. Only set `subdomain` when `plan = 'club'` — enforce in the API route, and add a DB check constraint or trigger. |
| **Subdomain conflicts** | Slugs must be globally unique (`UNIQUE` constraint on `organizations.subdomain`). Reserve `www`, `app`, `api`, `mail`, `admin`, `blog` as blocked values at the API layer. |
| **Auth cookies on custom domains (Phase 2)** | Supabase Auth cookies are scoped per origin. Users on `app.jogafc.org` have a separate session from `lista.team`. This is correct behavior — club members log in on their club's subdomain. No cross-domain session sharing needed. |
| **Stripe webhook idempotency** | Stripe can deliver webhooks more than once. Use `stripe_subscription_id` as an idempotency key and check current state before applying updates. |
| **Email on white-label** | Resend supports custom sending domains. The club setup flow should include a DNS step for `noreply@theirclub.com`. Until configured, fall back to `noreply@lista.team` with club name as from-name. |
| **Push notifications across Expo projects** | Each club app is a separate Expo project with its own APNs credentials. The notification send logic must group tokens by `expo_project_id` and use the corresponding Expo access token. New clubs require a new env var (`EXPO_TOKEN_{SLUG}`) added to Vercel — this is a manual step in the club onboarding process. |
| **APNs universal links per club app** | Each club app's `associatedDomains` must include its subdomain. If the subdomain changes after the app is published, a new binary is required (App Store change). Encourage clubs to lock in their subdomain before the app is submitted. |
| **App Store review time** | New club apps take 1–3 days for Apple review. Set expectations with clubs accordingly. Subsequent JS-only updates push via Expo OTA with no review. |
| **Apple Developer account (Lista-owned)** | All club apps publish under Lista's Apple Developer account. Clubs should be informed at onboarding that the publisher name in the App Store will be Lista's entity. Apple does not allow app transfers between developer accounts, so migration to a club-owned account later would require a new listing. |

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
| `src/app/api/account/transfer-ownership/route.ts` | Expand auth check: org directors can transfer in addition to current owner; add `director` to recipient eligibility |
| `src/app/actions/team.ts` | Same expansion to `transferOwnership()` server action |
| `src/app/api/club/` | **New** — org settings, domain management |
| `src/lib/invitations/invite-base-url.ts` | **New** — shared helper resolving correct base URL for invite links (org subdomain, custom domain, or default) |
| `src/app/api/invitations/send/route.ts` | Use `inviteBaseUrl()`; pass `brandName`/`logoUrl` to email template |
| `src/app/api/invitations/[id]/resend/route.ts` | Use `inviteBaseUrl()`; pass `brandName`/`logoUrl`; add `director` to role check |
| `src/lib/notifications/email.ts` | `buildInviteEmailHtml` accepts `brandName` + `logoUrl`; removes hardcoded Lista copy |
| `src/components/invite/invite-signup-form.tsx` | Accept `brandName` prop; replace hardcoded "lista" CardTitle |
| `src/app/api/teams/route.ts` | No change — free users have no team-count limit |
| `apps/web/vercel.json` | No change needed for subdomains (handled in Vercel UI) |
| `apps/web/package.json` | Add `stripe` dependency |
| `apps/web/env.example` | Add Stripe env vars, `VERCEL_API_TOKEN` (Phase 2), `EXPO_TOKEN_*` vars (Phase 3) |
| `apps/mobile/app.config.js` | Parameterize with `EXPO_PUBLIC_ORG_ID`, `EXPO_APP_NAME`, `EXPO_BUNDLE_ID` |
| `apps/mobile/eas.json` | Add per-club build profiles |
| `apps/mobile/src/lib/tenant.ts` | **New** — `ORG_ID` constant, `isWhiteLabel` flag |
| `apps/web/src/app/api/mobile/tenant/route.ts` | **New** — unauthenticated branding endpoint for mobile |
| `apps/web/src/app/api/notifications/send/route.ts` | Group tokens by `expo_project_id`, fan out per project |
| `apps/web/src/app/api/chat/notify/route.ts` | Same — group by `expo_project_id` |
| `scripts/build-club-app.sh` | **New** — parameterized EAS build script |
