-- ── Organization enhancements ─────────────────────────────────────────────────
-- Promotes organizations to the primary tenant boundary for multi-tenancy.
-- Adds slug, plan, branding, Stripe, and created_by columns.
-- Drops the old permissive RLS policies and replaces them with
-- membership-scoped ones.

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

-- ── New RLS policies ──────────────────────────────────────────────────────────

-- SELECT: visible to profiles that are a member of any team in this org,
-- or are an explicit org member in organization_members.
-- NOTE: is_org_admin() is defined in the organization_members migration which
-- must run after this one. This policy references organization_members directly
-- so it can be created here without a forward dependency on the helper.
CREATE POLICY "Orgs visible to members"
  ON organizations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      JOIN profiles p ON p.id = tm.profile_id
      WHERE t.organization_id = organizations.id
        AND p.auth_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM organization_members om
      JOIN profiles p ON p.id = om.profile_id
      WHERE om.organization_id = organizations.id
        AND p.auth_user_id = auth.uid()
    )
  );

-- UPDATE: only org owners/admins may update branding, settings, etc.
-- Uses is_org_admin() defined in the organization_members migration.
CREATE POLICY "Orgs updatable by org admins"
  ON organizations FOR UPDATE
  USING (is_org_admin(id));

-- INSERT: no permissive client policy — blocked by default-deny.
-- Org creation is only permitted via the create_team() service-role RPC.

-- DELETE: only the org owner may delete an org.
CREATE POLICY "Orgs deletable by org owner"
  ON organizations FOR DELETE
  USING (is_org_owner(id));
