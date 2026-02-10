-- Create US States table
CREATE TABLE IF NOT EXISTS us_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  abbreviation text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- Create index on abbreviation for faster lookups
CREATE INDEX idx_us_states_abbreviation ON us_states(abbreviation);

-- Enable RLS (optional - making it publicly readable)
ALTER TABLE us_states ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read access to US states
CREATE POLICY "Anyone can view US states"
  ON us_states
  FOR SELECT
  USING (true);

-- Insert all 50 US states with their abbreviations
INSERT INTO us_states (name, abbreviation) VALUES
  ('Alabama', 'AL'),
  ('Alaska', 'AK'),
  ('Arizona', 'AZ'),
  ('Arkansas', 'AR'),
  ('California', 'CA'),
  ('Colorado', 'CO'),
  ('Connecticut', 'CT'),
  ('Delaware', 'DE'),
  ('Florida', 'FL'),
  ('Georgia', 'GA'),
  ('Hawaii', 'HI'),
  ('Idaho', 'ID'),
  ('Illinois', 'IL'),
  ('Indiana', 'IN'),
  ('Iowa', 'IA'),
  ('Kansas', 'KS'),
  ('Kentucky', 'KY'),
  ('Louisiana', 'LA'),
  ('Maine', 'ME'),
  ('Maryland', 'MD'),
  ('Massachusetts', 'MA'),
  ('Michigan', 'MI'),
  ('Minnesota', 'MN'),
  ('Mississippi', 'MS'),
  ('Missouri', 'MO'),
  ('Montana', 'MT'),
  ('Nebraska', 'NE'),
  ('Nevada', 'NV'),
  ('New Hampshire', 'NH'),
  ('New Jersey', 'NJ'),
  ('New Mexico', 'NM'),
  ('New York', 'NY'),
  ('North Carolina', 'NC'),
  ('North Dakota', 'ND'),
  ('Ohio', 'OH'),
  ('Oklahoma', 'OK'),
  ('Oregon', 'OR'),
  ('Pennsylvania', 'PA'),
  ('Rhode Island', 'RI'),
  ('South Carolina', 'SC'),
  ('South Dakota', 'SD'),
  ('Tennessee', 'TN'),
  ('Texas', 'TX'),
  ('Utah', 'UT'),
  ('Vermont', 'VT'),
  ('Virginia', 'VA'),
  ('Washington', 'WA'),
  ('West Virginia', 'WV'),
  ('Wisconsin', 'WI'),
  ('Wyoming', 'WY');

-- Add comment
COMMENT ON TABLE us_states IS 'List of all 50 US states with their standard abbreviations';
