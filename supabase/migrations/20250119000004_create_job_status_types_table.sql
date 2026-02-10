-- Create JobStatusTypes table
CREATE TABLE IF NOT EXISTS job_status_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- Create index on name for faster lookups
CREATE INDEX idx_job_status_types_name ON job_status_types(name);

-- Enable RLS (optional - making it publicly readable)
ALTER TABLE job_status_types ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read access to job status types
CREATE POLICY "Anyone can view job status types"
  ON job_status_types
  FOR SELECT
  USING (true);

-- Insert the three job status types
INSERT INTO job_status_types (name) VALUES
  ('Draft'),
  ('In Use'),
  ('Ready');

-- Add comment
COMMENT ON TABLE job_status_types IS 'Job status types for tracking job workflow stages';
