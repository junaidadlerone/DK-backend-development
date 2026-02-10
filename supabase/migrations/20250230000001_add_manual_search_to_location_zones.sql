-- Add manual_search column to location_zones table
-- This field indicates whether the zone was created through manual search (true) or automated process (false)

ALTER TABLE location_zones
ADD COLUMN IF NOT EXISTS manual_search BOOLEAN DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN location_zones.manual_search IS 'Indicates whether the zone was created through manual search (true) or automated process (false)';
