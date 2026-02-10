-- Create location_zones table
CREATE TABLE IF NOT EXISTS location_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  center jsonb NOT NULL,
  mode text NOT NULL CHECK (mode IN ('radius', 'count')),
  search_type text NOT NULL DEFAULT 'ALL' CHECK (search_type IN ('ALL', 'RESIDENTIAL', 'OTHER')),
  metadata jsonb NOT NULL,
  addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index on campaign_id for faster lookups
CREATE INDEX idx_location_zones_campaign_id ON location_zones(campaign_id);

-- Enable RLS (policies handled at application level via Edge Functions)
ALTER TABLE location_zones ENABLE ROW LEVEL SECURITY;

-- Policy: Allow service role full access (for Edge Functions)
CREATE POLICY "Service role has full access"
  ON location_zones
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add comment
COMMENT ON TABLE location_zones IS 'Stores geographic zones with discovered addresses for campaigns';
