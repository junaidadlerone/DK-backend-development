-- Create maintainence table
CREATE TABLE IF NOT EXISTS maintainence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "isUnderMaintainence" boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

-- Seed a single row that the app will always read
INSERT INTO maintainence ("isUnderMaintainence")
VALUES (false)
ON CONFLICT DO NOTHING;

-- Enable RLS
ALTER TABLE maintainence ENABLE ROW LEVEL SECURITY;

-- Service role can manage the table
CREATE POLICY "Service role can manage maintainence"
  ON maintainence
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Any authenticated user can read
CREATE POLICY "Authenticated users can read maintainence"
  ON maintainence
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE maintainence IS 'Global maintenance mode flag. Always contains a single row.';
