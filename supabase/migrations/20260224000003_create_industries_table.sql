-- Create industries table
CREATE TABLE IF NOT EXISTS industries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_industries_name ON industries(name);

ALTER TABLE industries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Anyone can view industries"
    ON industries FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can manage industries"
    ON industries FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Insert industry categories
INSERT INTO industries (name) VALUES
  ('Residential Services'),
  ('Commercial Services'),
  ('Industrial Services'),
  ('Government & Municipal Services'),
  ('Construction & Contracting'),
  ('General Contracting'),
  ('Specialty Trades'),
  ('Infrastructure & Civil Works'),
  ('Preventative Maintenance'),
  ('Emergency Services'),
  ('Installation Services'),
  ('Assembly Services'),
  ('Electrical Services'),
  ('Plumbing Services'),
  ('HVAC & Mechanical'),
  ('Appliance Services'),
  ('Cleaning Services'),
  ('Janitorial Services'),
  ('Restoration & Remediation'),
  ('Waste Management'),
  ('Pest & Wildlife Control'),
  ('Landscaping & Outdoor Services'),
  ('Snow & Seasonal Services'),
  ('Pool & Water Systems'),
  ('Automotive Services'),
  ('Fleet Services'),
  ('Mobile Services'),
  ('Facility Management'),
  ('Property Management'),
  ('Real Estate Services'),
  ('Security Systems'),
  ('Fire & Safety Services'),
  ('Inspection Services'),
  ('Compliance & Auditing'),
  ('Energy Services'),
  ('Solar & Renewable Energy'),
  ('Utilities & Infrastructure'),
  ('Telecom Services'),
  ('IT & Networking'),
  ('Low Voltage Systems'),
  ('Healthcare Services'),
  ('Home Healthcare'),
  ('Personal Care Services'),
  ('Logistics Services'),
  ('Courier & Delivery'),
  ('Moving & Hauling'),
  ('Hospitality Services'),
  ('Event Services'),
  ('Retail Services'),
  ('Professional Services'),
  ('Manufacturing Services'),
  ('Industrial Maintenance'),
  ('Agriculture & Farming Services'),
  ('Marine & Coastal Services')
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE industries IS 'Industry categories used for organization classification and referral filtering.';
