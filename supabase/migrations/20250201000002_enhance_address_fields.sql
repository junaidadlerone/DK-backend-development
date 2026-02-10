-- Enhance address fields in location_zones table
-- This migration adds new fields to address objects stored in the addresses JSONB column

-- Add zone_name field to location_zones table for targeting_zone_name reference
ALTER TABLE location_zones 
ADD COLUMN zone_name text,
ADD COLUMN zone_type text; -- "radius(1.5km)" or "point(50 addresses)"

-- Create a function to update existing address objects with new fields
CREATE OR REPLACE FUNCTION enhance_address_objects()
RETURNS void AS $$
BEGIN
  -- This function will be called to update existing address objects
  -- New address objects will be created with enhanced fields by the API
  UPDATE location_zones 
  SET addresses = (
    SELECT jsonb_agg(
      CASE 
        WHEN jsonb_typeof(addr) = 'object' THEN 
          addr || jsonb_build_object(
            'propertyType', COALESCE(addr->>'building_type', 'Unknown'),
            'distanceFromCenter', 0, -- Will be calculated by API
            'targeting_zone_name', COALESCE(zone_name, 'Unnamed Zone'),
            'campaigns_used_in', '[]'::jsonb,
            'zoneType', COALESCE(zone_type, mode),
            'postcards_sent', 0,
            'first_post_card_sent_date', null,
            'status', 'UnVerified'
          )
        ELSE addr
      END
    )
    FROM jsonb_array_elements(addresses) AS addr
  )
  WHERE jsonb_array_length(addresses) > 0;
END;
$$ LANGUAGE plpgsql;

-- Add comments
COMMENT ON COLUMN location_zones.zone_name IS 'Human-readable name for the targeting zone based on the main address';
COMMENT ON COLUMN location_zones.zone_type IS 'Type of zone search performed, e.g., "radius(1.5km)" or "point(50 addresses)"';
COMMENT ON FUNCTION enhance_address_objects() IS 'Updates existing address objects with new enhanced fields';

-- Index for better performance on zone_name searches
CREATE INDEX idx_location_zones_zone_name ON location_zones(zone_name);