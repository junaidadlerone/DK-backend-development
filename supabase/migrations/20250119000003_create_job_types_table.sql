-- Create JobTypes table
CREATE TABLE IF NOT EXISTS job_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- Create index on name for faster lookups
CREATE INDEX idx_job_types_name ON job_types(name);

-- Enable RLS (optional - making it publicly readable)
ALTER TABLE job_types ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read access to job types
CREATE POLICY "Anyone can view job types"
  ON job_types
  FOR SELECT
  USING (true);

-- Insert comprehensive list of construction and home service job types
INSERT INTO job_types (name) VALUES
  -- HVAC Services
  ('HVAC Installation'),
  ('HVAC Repair'),
  ('HVAC Maintenance'),
  ('Furnace Installation'),
  ('Furnace Repair'),
  ('Furnace Tune-Up'),
  ('AC Installation'),
  ('AC Repair'),
  ('AC Maintenance'),
  ('Duct Cleaning'),
  ('Duct Installation'),
  ('Duct Repair'),
  ('Thermostat Installation'),
  ('Air Quality Testing'),
  ('Ventilation System Installation'),

  -- Plumbing Services
  ('Plumbing Installation'),
  ('Plumbing Repair'),
  ('Drain Cleaning'),
  ('Pipe Installation'),
  ('Pipe Repair'),
  ('Water Heater Installation'),
  ('Water Heater Repair'),
  ('Leak Detection'),
  ('Leak Repair'),
  ('Toilet Installation'),
  ('Toilet Repair'),
  ('Faucet Installation'),
  ('Faucet Repair'),
  ('Sewer Line Repair'),
  ('Sewer Line Replacement'),
  ('Garbage Disposal Installation'),
  ('Water Line Repair'),
  ('Sump Pump Installation'),
  ('Sump Pump Repair'),

  -- Electrical Services
  ('Electrical Installation'),
  ('Electrical Repair'),
  ('Wiring Installation'),
  ('Wiring Repair'),
  ('Circuit Breaker Installation'),
  ('Circuit Breaker Repair'),
  ('Lighting Installation'),
  ('Lighting Repair'),
  ('Outlet Installation'),
  ('Outlet Repair'),
  ('Switch Installation'),
  ('Panel Upgrade'),
  ('Ceiling Fan Installation'),
  ('Generator Installation'),
  ('Generator Repair'),
  ('Smoke Detector Installation'),
  ('Security System Installation'),
  ('Home Automation Installation'),

  -- Roofing Services
  ('Roof Installation'),
  ('Roof Repair'),
  ('Roof Replacement'),
  ('Roof Inspection'),
  ('Shingle Replacement'),
  ('Flat Roof Installation'),
  ('Flat Roof Repair'),
  ('Gutter Installation'),
  ('Gutter Cleaning'),
  ('Gutter Repair'),
  ('Downspout Installation'),
  ('Skylight Installation'),
  ('Skylight Repair'),
  ('Roof Leak Repair'),
  ('Roof Ventilation Installation'),

  -- Carpentry Services
  ('Carpentry'),
  ('Framing'),
  ('Deck Construction'),
  ('Deck Repair'),
  ('Cabinet Installation'),
  ('Cabinet Repair'),
  ('Door Installation'),
  ('Door Repair'),
  ('Window Installation'),
  ('Window Repair'),
  ('Trim Installation'),
  ('Crown Molding Installation'),
  ('Baseboard Installation'),
  ('Custom Woodwork'),

  -- Flooring Services
  ('Hardwood Floor Installation'),
  ('Hardwood Floor Refinishing'),
  ('Tile Installation'),
  ('Tile Repair'),
  ('Carpet Installation'),
  ('Carpet Repair'),
  ('Laminate Flooring Installation'),
  ('Vinyl Flooring Installation'),
  ('Floor Sanding'),
  ('Floor Polishing'),

  -- Painting Services
  ('Interior Painting'),
  ('Exterior Painting'),
  ('Cabinet Painting'),
  ('Deck Staining'),
  ('Fence Staining'),
  ('Wallpaper Installation'),
  ('Wallpaper Removal'),
  ('Drywall Installation'),
  ('Drywall Repair'),
  ('Texture Removal'),

  -- Masonry & Concrete
  ('Concrete Installation'),
  ('Concrete Repair'),
  ('Foundation Repair'),
  ('Brick Installation'),
  ('Brick Repair'),
  ('Stone Installation'),
  ('Chimney Repair'),
  ('Patio Installation'),
  ('Driveway Installation'),
  ('Sidewalk Installation'),
  ('Retaining Wall Installation'),

  -- Landscaping Services
  ('Landscaping'),
  ('Lawn Maintenance'),
  ('Tree Trimming'),
  ('Tree Removal'),
  ('Irrigation System Installation'),
  ('Irrigation System Repair'),
  ('Landscape Design'),
  ('Sod Installation'),
  ('Mulch Installation'),
  ('Garden Installation'),

  -- Insulation Services
  ('Insulation Installation'),
  ('Insulation Removal'),
  ('Attic Insulation'),
  ('Wall Insulation'),
  ('Crawl Space Insulation'),
  ('Weatherization'),

  -- Siding Services
  ('Siding Installation'),
  ('Siding Repair'),
  ('Vinyl Siding Installation'),
  ('Wood Siding Installation'),
  ('Fascia Repair'),
  ('Soffit Repair'),

  -- Window & Door Services
  ('Window Replacement'),
  ('Door Replacement'),
  ('Storm Door Installation'),
  ('Screen Door Installation'),
  ('Garage Door Installation'),
  ('Garage Door Repair'),
  ('Garage Door Opener Installation'),

  -- Cleaning Services
  ('Carpet Cleaning'),
  ('Upholstery Cleaning'),
  ('Power Washing'),
  ('Window Cleaning'),
  ('Chimney Cleaning'),

  -- Specialty Services
  ('Demolition'),
  ('Waterproofing'),
  ('Mold Remediation'),
  ('Pest Control'),
  ('Appliance Installation'),
  ('Appliance Repair'),
  ('Home Inspection'),
  ('Energy Audit'),
  ('Solar Panel Installation'),
  ('Pool Installation'),
  ('Pool Repair'),
  ('Pool Maintenance'),
  ('Fence Installation'),
  ('Fence Repair'),
  ('Welding Services'),
  ('Metal Fabrication'),
  ('Glass Installation'),
  ('Mirror Installation'),

  -- Remodeling Services
  ('Kitchen Remodeling'),
  ('Bathroom Remodeling'),
  ('Basement Finishing'),
  ('Home Addition'),
  ('Room Addition'),
  ('Attic Conversion'),
  ('Garage Conversion'),

  -- Emergency Services
  ('Emergency Plumbing'),
  ('Emergency Electrical'),
  ('Emergency HVAC'),
  ('Emergency Roof Repair'),
  ('Water Damage Restoration'),
  ('Fire Damage Restoration'),

  -- Smart Home Services
  ('Smart Home Installation'),
  ('Smart Thermostat Installation'),
  ('Smart Lock Installation'),
  ('Security Camera Installation'),
  ('Home Theater Installation'),

  -- Other
  ('Other');

-- Add comment
COMMENT ON TABLE job_types IS 'Comprehensive list of construction and home service job types';
