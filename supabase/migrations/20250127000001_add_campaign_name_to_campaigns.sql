-- Add campaign_name column to campaigns table
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_name text;

-- Add comment
COMMENT ON COLUMN campaigns.campaign_name IS 'Name of the campaign, set in step 1';
