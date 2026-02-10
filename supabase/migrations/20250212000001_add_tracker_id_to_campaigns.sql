-- Add tracker_id column to campaigns table
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS tracker_id bigint;

-- Add comment
COMMENT ON COLUMN campaigns.tracker_id IS 'Linkly tracker ID for QR code tracking, generated when qr_url is provided in step 4';
