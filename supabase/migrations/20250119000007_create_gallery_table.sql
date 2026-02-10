-- Create gallery table
CREATE TABLE IF NOT EXISTS gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  images jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(referral_id)
);

-- Enable RLS
ALTER TABLE gallery ENABLE ROW LEVEL SECURITY;

-- Create policies
-- Service role policy (full access)
CREATE POLICY "Service role has full access to gallery"
  ON gallery
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read galleries
CREATE POLICY "Authenticated users can read galleries"
  ON gallery
  FOR SELECT
  TO authenticated
  USING (true);

-- Add index for faster lookups
CREATE INDEX idx_gallery_referral_id ON gallery(referral_id);

-- Add comment
COMMENT ON TABLE gallery IS 'Stores photo galleries linked to referrals with before/after/none image types';
