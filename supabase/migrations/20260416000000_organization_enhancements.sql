-- ── Organization enhancements ─────────────────────────────────────────────────
-- Promotes organizations to the primary tenant boundary for multi-tenancy.
-- Adds slug, plan, branding, Stripe, and created_by columns.
-- Drops the old permissive RLS policies.
--
-- The new membership-scoped RLS policies for organizations are defined in
-- 20260416000001_organization_members.sql, which runs next and creates the
-- organization_members table and is_org_admin()/is_org_owner() helpers that
-- those policies depend on.

-- ── New columns ───────────────────────────────────────────────────────────────

-- slug: added nullable first; backfilled in a later migration; then constrained.
-- Adding NOT NULL + UNIQUE before backfill would fail on existing rows.
ALTER TABLE organizations ADD COLUMN slug text;

ALTER TABLE organizations ADD COLUMN plan text NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free', 'club'));

-- subdomain: 'jogafc' → jogafc.lista.team
-- Only set when plan = 'club' (enforced at the API layer).
ALTER TABLE organizations ADD COLUMN subdomain text UNIQUE;

-- custom_domain reserved for Phase 2
ALTER TABLE organizations ADD COLUMN custom_domain text UNIQUE;

ALTER TABLE organizations ADD COLUMN brand_color text;            -- hex e.g. '#1a2f5e'
ALTER TABLE organizations ADD COLUMN brand_color_secondary text;
ALTER TABLE organizations ADD COLUMN logo_url text;
ALTER TABLE organizations ADD COLUMN favicon_url text;

-- Display name used in white-label UI (may differ from internal org name)
ALTER TABLE organizations ADD COLUMN org_name_public text;

ALTER TABLE organizations ADD COLUMN stripe_customer_id text;
ALTER TABLE organizations ADD COLUMN stripe_subscription_id text;
ALTER TABLE organizations ADD COLUMN subscription_status text
  CHECK (subscription_status IN ('active', 'past_due', 'canceled'));
  -- NULL for free orgs with no Stripe subscription

ALTER TABLE organizations ADD COLUMN created_by uuid REFERENCES profiles(id);

-- ── Drop old permissive RLS policies ─────────────────────────────────────────
-- Both allowed any authenticated user to read all orgs or insert directly.
-- The new model: SELECT is membership-scoped; INSERT is blocked for clients
-- entirely (org creation only permitted via the create_team() service-role RPC).

DROP POLICY IF EXISTS "Org visible to authenticated users" ON organizations;
DROP POLICY IF EXISTS "Authenticated users can create orgs" ON organizations;

-- Legacy names used in the initial migration — drop both variants to be safe.
DROP POLICY IF EXISTS "Authenticated users can view organizations" ON organizations;
DROP POLICY IF EXISTS "Authenticated users can insert organizations" ON organizations;

-- New RLS policies for organizations are created at the end of
-- 20260416000001_organization_members.sql after organization_members,
-- is_org_admin(), and is_org_owner() are all defined.
