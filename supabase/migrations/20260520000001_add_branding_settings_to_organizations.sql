-- Add branding_settings (JSONB) to organizations so each org (including agency sub-orgs)
-- can have its own logo + theme. Previously branding_settings lived only on profiles,
-- which prevents agencies from setting per-client branding.
--
-- Shape mirrors profiles.branding_settings:
--   { logo: "<url>", theme: { colors: { primary, secondary, accent }, fonts: { primary: { name }, body: { name } } } }

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS branding_settings JSONB DEFAULT NULL;

COMMENT ON COLUMN organizations.branding_settings IS
  'Per-org branding (logo URL + theme colors/fonts). For agencies, each sub-org has its own.';

-- Backfill: copy profiles.branding_settings into the user's earliest org (their primary org).
-- "Earliest org per owner" is the same pattern used in 20260408000001_fix_is_agency_for_sub_orgs.sql.
UPDATE organizations o
SET branding_settings = p.branding_settings
FROM profiles p
WHERE o.branding_settings IS NULL
  AND p.branding_settings IS NOT NULL
  AND o.owner_id = p.id
  AND NOT EXISTS (
    SELECT 1
    FROM organizations older
    WHERE older.owner_id = o.owner_id
      AND older.created_at < o.created_at
  );
