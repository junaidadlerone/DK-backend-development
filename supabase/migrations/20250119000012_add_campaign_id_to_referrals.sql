-- Add campaign_id to referrals table
ALTER TABLE referrals ADD COLUMN campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;

-- Create index for campaign-based queries
CREATE INDEX idx_referrals_campaign_id ON referrals(campaign_id);

-- Add comment
COMMENT ON COLUMN referrals.campaign_id IS 'Campaign associated with this referral';
