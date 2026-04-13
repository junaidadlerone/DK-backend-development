-- Migration: Add center, zone_name and validated_address_list to campaign_csv_address_lists
-- Date: 2026-04-12

ALTER TABLE campaign_csv_address_lists 
ADD COLUMN IF NOT EXISTS center jsonb,
ADD COLUMN IF NOT EXISTS zone_name text;

COMMENT ON COLUMN campaign_csv_address_lists.center IS 'Average lat/long of all geocoded addresses in the list';
COMMENT ON COLUMN campaign_csv_address_lists.zone_name IS 'Common zone name for the address list, usually derived from the center point';
