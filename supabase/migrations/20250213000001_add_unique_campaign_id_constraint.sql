-- First, delete duplicate entries, keeping only the most recent one per campaign
DELETE FROM launch_ready_campaign_data
WHERE id NOT IN (
  SELECT DISTINCT ON (campaign_id) id
  FROM launch_ready_campaign_data
  ORDER BY campaign_id, created_at DESC
);

-- Add unique constraint on campaign_id to prevent duplicates
ALTER TABLE launch_ready_campaign_data
ADD CONSTRAINT unique_campaign_id UNIQUE (campaign_id);

-- Add comment
COMMENT ON CONSTRAINT unique_campaign_id ON launch_ready_campaign_data IS 'Ensures only one launch data entry per campaign';
