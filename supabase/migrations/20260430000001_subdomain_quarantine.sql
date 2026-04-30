-- Sprint 6: Subdomain quarantine on downgrade/cancellation
--
-- Instead of clearing organizations.subdomain when a club downgrades, we keep
-- the value and mark it quarantined for 180 days. The UNIQUE constraint
-- continues to block takeover attempts for free; a daily cron releases
-- expired quarantines. See spec §1.10 for full design rationale.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS subdomain_status        text
    CHECK (subdomain_status IN ('active', 'quarantined')),
  ADD COLUMN IF NOT EXISTS subdomain_quarantined_at timestamptz;

-- Backfill: any existing non-null subdomain is already active.
UPDATE organizations
SET subdomain_status = 'active'
WHERE subdomain IS NOT NULL;
