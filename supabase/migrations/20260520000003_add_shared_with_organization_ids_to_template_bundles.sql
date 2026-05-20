-- Adds explicit per-org sharing for template bundles.
-- A bundle with `organization_id = X` and `shared_with_organization_ids = ['Y','Z']`
-- is visible to members of X, Y, and Z. Universal bundles are unaffected.
-- New bundles default to '{}'::UUID[] so existing flows are backwards-compatible.

ALTER TABLE template_bundles
  ADD COLUMN IF NOT EXISTS shared_with_organization_ids UUID[] NOT NULL DEFAULT '{}'::UUID[];

COMMENT ON COLUMN template_bundles.shared_with_organization_ids IS
  'Orgs the bundle is explicitly shared with (in addition to organization_id). Managed by shareTemplateBundleV3 / unshareTemplateBundleV3.';

-- GIN index for fast `ANY(shared_with_organization_ids)` membership lookups.
CREATE INDEX IF NOT EXISTS idx_template_bundles_shared_with
  ON template_bundles USING GIN (shared_with_organization_ids);
