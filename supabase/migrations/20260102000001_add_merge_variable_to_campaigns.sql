-- Add merge_variable column to campaigns table
-- This column stores custom merge variables as JSON for mail merge operations

ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS merge_variable JSONB;

COMMENT ON COLUMN campaigns.merge_variable IS 'Custom merge variables stored as JSON for mail merge operations';
