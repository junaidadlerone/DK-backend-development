-- Add start_date and end_date to campaigns table
ALTER TABLE "public"."campaigns" 
ADD COLUMN IF NOT EXISTS "start_date" timestamptz,
ADD COLUMN IF NOT EXISTS "end_date" timestamptz;

-- Comment
COMMENT ON COLUMN campaigns.start_date IS 'Campaign start date';
COMMENT ON COLUMN campaigns.end_date IS 'Campaign end date';
