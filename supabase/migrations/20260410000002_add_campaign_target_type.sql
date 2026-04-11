-- Migration: Add campaign_target_type enum and column to campaigns
-- Date: 2026-04-10

-- 1. Create the enum type
DO $$ BEGIN
    CREATE TYPE campaign_target_type AS ENUM ('Referrals', 'Location Zone', 'Address List');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Add column to campaigns
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS campaign_target_type campaign_target_type;

-- 3. Retroactively populate campaign_target_type with priority:
-- 1. Referrals (if referral_id is present)
-- 2. Location Zone (if zone_id is present)
-- 3. Address List (if csv_address_list_id is present)
-- 4. Default to Location Zone
UPDATE campaigns
SET campaign_target_type = CASE
    WHEN referral_id IS NOT NULL THEN 'Referrals'::campaign_target_type
    WHEN zone_id IS NOT NULL THEN 'Location Zone'::campaign_target_type
    WHEN csv_address_list_id IS NOT NULL THEN 'Address List'::campaign_target_type
    ELSE 'Location Zone'::campaign_target_type
END
WHERE campaign_target_type IS NULL;

-- 4. Add comment
COMMENT ON COLUMN campaigns.campaign_target_type IS 'Explicit targeting type chosen during Step 1 of creation';
