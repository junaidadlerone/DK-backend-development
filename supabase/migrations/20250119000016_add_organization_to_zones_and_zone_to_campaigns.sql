-- Add organization_id to location_zones for organization-based access control
ALTER TABLE location_zones ADD COLUMN organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE;

-- Create index on organization_id for faster lookups
CREATE INDEX idx_location_zones_organization_id ON location_zones(organization_id);

-- Add zone_id to campaigns table
ALTER TABLE campaigns ADD COLUMN zone_id uuid REFERENCES location_zones(id) ON DELETE SET NULL;

-- Create index on zone_id for faster lookups
CREATE INDEX idx_campaigns_zone_id ON campaigns(zone_id);

-- Add comment
COMMENT ON COLUMN location_zones.organization_id IS 'Organization that owns this zone';
COMMENT ON COLUMN campaigns.zone_id IS 'Location zone linked to this campaign (Step 5)';
