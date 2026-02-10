-- Update gallery table to support organization-level galleries
-- This allows galleries to be linked either to a referral OR to an organization directly

-- Step 1: Add organization_id column
ALTER TABLE gallery
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

-- Step 2: Make referral_id nullable
ALTER TABLE gallery
ALTER COLUMN referral_id DROP NOT NULL;

-- Step 3: Drop the old unique constraint on referral_id
ALTER TABLE gallery
DROP CONSTRAINT IF EXISTS gallery_referral_id_key;

-- Step 4: Add new constraints
-- Either referral_id OR organization_id must be provided (but not both)
ALTER TABLE gallery
ADD CONSTRAINT gallery_referral_or_organization_check
CHECK (
  (referral_id IS NOT NULL AND organization_id IS NULL) OR
  (referral_id IS NULL AND organization_id IS NOT NULL)
);

-- Step 5: Add unique constraint for referral_id when it's not null
CREATE UNIQUE INDEX IF NOT EXISTS gallery_referral_id_unique
ON gallery(referral_id)
WHERE referral_id IS NOT NULL;

-- Step 6: Add unique constraint for organization_id when it's not null (one gallery per organization)
CREATE UNIQUE INDEX IF NOT EXISTS gallery_organization_id_unique
ON gallery(organization_id)
WHERE organization_id IS NOT NULL;

-- Step 7: Add index for organization_id lookups
CREATE INDEX IF NOT EXISTS idx_gallery_organization_id ON gallery(organization_id);

-- Step 8: Update comment
COMMENT ON TABLE gallery IS 'Stores photo galleries linked to referrals or organizations. Each referral can have one gallery, and each organization can have one organization-level gallery.';

-- Step 9: Add column comments
COMMENT ON COLUMN gallery.referral_id IS 'Referral ID if this is a referral-level gallery (mutually exclusive with organization_id)';
COMMENT ON COLUMN gallery.organization_id IS 'Organization ID if this is an organization-level gallery (mutually exclusive with referral_id)';
