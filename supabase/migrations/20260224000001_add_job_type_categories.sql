-- Add new job type categories to job_types table
INSERT INTO job_types (name) VALUES
  -- Service Scopes
  ('Residential Services'),
  ('Commercial Services'),
  ('Industrial Services'),
  ('Government & Municipal Services'),

  -- Construction & Contracting
  ('Construction & Contracting'),
  ('General Contracting'),
  ('Specialty Trades'),
  ('Infrastructure & Civil Works'),

  -- Maintenance & Repair
  ('Preventative Maintenance'),
  ('Emergency Services'),
  ('Installation Services'),
  ('Assembly Services'),

  -- Trade Verticals
  ('Electrical Services'),
  ('Plumbing Services'),
  ('HVAC & Mechanical'),
  ('Appliance Services'),

  -- Cleaning & Remediation
  ('Cleaning Services'),
  ('Janitorial Services'),
  ('Restoration & Remediation'),
  ('Waste Management'),
  ('Pest & Wildlife Control'),

  -- Outdoor & Seasonal
  ('Landscaping & Outdoor Services'),
  ('Snow & Seasonal Services'),
  ('Pool & Water Systems'),

  -- Automotive
  ('Automotive Services'),
  ('Fleet Services'),
  ('Mobile Services'),

  -- Property & Facilities
  ('Facility Management'),
  ('Property Management'),
  ('Real Estate Services'),

  -- Safety & Compliance
  ('Security Systems'),
  ('Fire & Safety Services'),
  ('Inspection Services'),
  ('Compliance & Auditing'),

  -- Energy & Utilities
  ('Energy Services'),
  ('Solar & Renewable Energy'),
  ('Utilities & Infrastructure'),

  -- Technology
  ('Telecom Services'),
  ('IT & Networking'),
  ('Low Voltage Systems'),

  -- Healthcare
  ('Healthcare Services'),
  ('Home Healthcare'),
  ('Personal Care Services'),

  -- Logistics
  ('Logistics Services'),
  ('Courier & Delivery'),
  ('Moving & Hauling'),

  -- Hospitality & Events
  ('Hospitality Services'),
  ('Event Services'),

  -- Retail & Professional
  ('Retail Services'),
  ('Professional Services'),

  -- Manufacturing & Industry
  ('Manufacturing Services'),
  ('Industrial Maintenance'),

  -- Specialized Sectors
  ('Agriculture & Farming Services'),
  ('Marine & Coastal Services')

ON CONFLICT (name) DO NOTHING;
