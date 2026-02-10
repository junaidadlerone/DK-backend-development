-- Add address field to location_zones table
-- This stores the original address input from the user (can be lat,lng or full text address)
ALTER TABLE location_zones
ADD COLUMN address text;

-- Add comment
COMMENT ON COLUMN location_zones.address IS 'Original address input from user (lat,lng format or full text address)';

-- Create index for searching
CREATE INDEX idx_location_zones_address ON location_zones(address);
