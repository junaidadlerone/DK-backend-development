-- Create Campaign Status Types table
CREATE TABLE IF NOT EXISTS campaign_status_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Insert default status types
INSERT INTO campaign_status_types (name) VALUES
  ('Draft'),
  ('Active'),
  ('In Active')
ON CONFLICT (name) DO NOTHING;

-- Enable RLS
ALTER TABLE campaign_status_types ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything (for edge functions)
CREATE POLICY "Service role can manage all campaign status types"
  ON campaign_status_types
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Authenticated users can read all status types
CREATE POLICY "Authenticated users can view campaign status types"
  ON campaign_status_types
  FOR SELECT
  TO authenticated
  USING (true);

-- Add comment
COMMENT ON TABLE campaign_status_types IS 'Campaign status types: Draft, Active, In Active';
