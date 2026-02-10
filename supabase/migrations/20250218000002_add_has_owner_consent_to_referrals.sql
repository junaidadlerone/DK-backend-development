-- Add hasOwnerConsent field to referrals table
-- This boolean field indicates whether the homeowner has given consent for the referral
ALTER TABLE referrals
ADD COLUMN "hasOwnerConsent" boolean DEFAULT false;

-- Add comment
COMMENT ON COLUMN referrals."hasOwnerConsent" IS 'Indicates whether the homeowner has given consent for the referral';

-- Create index for filtering by consent status
CREATE INDEX idx_referrals_has_owner_consent ON referrals("hasOwnerConsent");
