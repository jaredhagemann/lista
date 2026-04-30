-- ── Backfill: org slugs + organization_members ────────────────────────────────
-- Runs after the schema additions in migrations 000000–000002.
--
-- Steps:
--   1. Generate slugs for all existing organizations from their name.
--   2. Apply NOT NULL + UNIQUE constraint on slug (safe now that all rows
--      have a value).
--   3. Backfill organization_members with one 'owner' row per org, using the
--      owner_id of the team with the earliest created_at in that org.
--      Uses ON CONFLICT DO NOTHING — the partial unique index on
--      (organization_id) WHERE role = 'owner' rejects duplicates, so if an
--      org somehow has multiple teams with different owners, only the earliest
--      team's owner is inserted and the rest are skipped silently.
--   4. Backfill organizations.created_by from the owner row just inserted.

-- ── Step 1: generate slugs ────────────────────────────────────────────────────
-- Pattern: lowercase, replace non-alphanumeric runs with '-', truncate to
-- 48 chars, strip leading/trailing hyphens, deduplicate with _2/_3 suffix.

UPDATE organizations
SET slug = (
  WITH base AS (
    SELECT
      id,
      -- Slugify: lowercase + collapse non-alphanumeric to '-', trim to 48 chars
      TRIM(BOTH '-' FROM
        SUBSTRING(
          LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')),
          1, 48
        )
      ) AS raw_slug
    FROM organizations
  ),
  ranked AS (
    SELECT
      id,
      raw_slug,
      ROW_NUMBER() OVER (PARTITION BY raw_slug ORDER BY created_at) AS rn
    FROM base
  )
  SELECT
    CASE WHEN rn = 1 THEN raw_slug
         ELSE raw_slug || '_' || rn::text
    END
  FROM ranked
  WHERE ranked.id = organizations.id
);

-- ── Step 2: apply NOT NULL + UNIQUE on slug ───────────────────────────────────
ALTER TABLE organizations ALTER COLUMN slug SET NOT NULL;
ALTER TABLE organizations ADD CONSTRAINT organizations_slug_key UNIQUE (slug);

-- ── Step 3: backfill organization_members ────────────────────────────────────
-- Insert one 'owner' row per org using the earliest team's owner_id.
-- ON CONFLICT DO NOTHING handles any pre-existing multi-team orgs defensively.
INSERT INTO organization_members (organization_id, profile_id, role)
SELECT DISTINCT ON (t.organization_id)
  t.organization_id,
  t.owner_id,
  'owner'
FROM teams t
WHERE t.owner_id IS NOT NULL
ORDER BY t.organization_id, t.created_at
ON CONFLICT DO NOTHING;

-- ── Step 4: backfill organizations.created_by ────────────────────────────────
UPDATE organizations o
SET created_by = om.profile_id
FROM organization_members om
WHERE om.organization_id = o.id
  AND om.role = 'owner'
  AND o.created_by IS NULL;
