-- Add merge_variable column to launch_ready_campaign_data table
-- This column stores custom merge variables as JSON for mail merge operations

ALTER TABLE launch_ready_campaign_data
ADD COLUMN IF NOT EXISTS merge_variable JSONB;

COMMENT ON COLUMN launch_ready_campaign_data.merge_variable IS 'Custom merge variables stored as JSON for mail merge operations';
