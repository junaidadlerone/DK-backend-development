-- Create cities table
CREATE TABLE IF NOT EXISTS us_cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state_id uuid NOT NULL REFERENCES us_states(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(name, state_id)
);

-- Create index on state_id for faster joins
CREATE INDEX idx_us_cities_state_id ON us_cities(state_id);

-- Create index on name for faster searches
CREATE INDEX idx_us_cities_name ON us_cities(name);

-- Enable RLS (making it publicly readable)
ALTER TABLE us_cities ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read access to cities
CREATE POLICY "Anyone can view US cities"
  ON us_cities
  FOR SELECT
  USING (true);

-- Insert major cities for each state
-- Note: Adding top cities for each state. You can expand this list as needed.

DO $$
DECLARE
  state_record RECORD;
BEGIN
  -- Alabama
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'AL';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Birmingham', state_record.id),
    ('Montgomery', state_record.id),
    ('Mobile', state_record.id),
    ('Huntsville', state_record.id);

  -- Alaska
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'AK';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Anchorage', state_record.id),
    ('Fairbanks', state_record.id),
    ('Juneau', state_record.id);

  -- Arizona
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'AZ';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Phoenix', state_record.id),
    ('Tucson', state_record.id),
    ('Mesa', state_record.id),
    ('Scottsdale', state_record.id);

  -- Arkansas
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'AR';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Little Rock', state_record.id),
    ('Fort Smith', state_record.id),
    ('Fayetteville', state_record.id);

  -- California
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'CA';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Los Angeles', state_record.id),
    ('San Francisco', state_record.id),
    ('San Diego', state_record.id),
    ('San Jose', state_record.id),
    ('Sacramento', state_record.id),
    ('Oakland', state_record.id);

  -- Colorado
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'CO';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Denver', state_record.id),
    ('Colorado Springs', state_record.id),
    ('Aurora', state_record.id),
    ('Boulder', state_record.id);

  -- Connecticut
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'CT';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Hartford', state_record.id),
    ('New Haven', state_record.id),
    ('Stamford', state_record.id);

  -- Delaware
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'DE';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Wilmington', state_record.id),
    ('Dover', state_record.id);

  -- Florida
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'FL';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Miami', state_record.id),
    ('Orlando', state_record.id),
    ('Tampa', state_record.id),
    ('Jacksonville', state_record.id),
    ('Fort Lauderdale', state_record.id);

  -- Georgia
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'GA';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Atlanta', state_record.id),
    ('Savannah', state_record.id),
    ('Augusta', state_record.id),
    ('Columbus', state_record.id);

  -- Hawaii
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'HI';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Honolulu', state_record.id),
    ('Hilo', state_record.id);

  -- Idaho
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'ID';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Boise', state_record.id),
    ('Meridian', state_record.id);

  -- Illinois
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'IL';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Chicago', state_record.id),
    ('Aurora', state_record.id),
    ('Naperville', state_record.id),
    ('Springfield', state_record.id);

  -- Indiana
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'IN';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Indianapolis', state_record.id),
    ('Fort Wayne', state_record.id),
    ('Evansville', state_record.id);

  -- Iowa
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'IA';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Des Moines', state_record.id),
    ('Cedar Rapids', state_record.id);

  -- Kansas
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'KS';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Wichita', state_record.id),
    ('Overland Park', state_record.id),
    ('Kansas City', state_record.id);

  -- Kentucky
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'KY';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Louisville', state_record.id),
    ('Lexington', state_record.id);

  -- Louisiana
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'LA';
  INSERT INTO us_cities (name, state_id) VALUES
    ('New Orleans', state_record.id),
    ('Baton Rouge', state_record.id),
    ('Shreveport', state_record.id);

  -- Maine
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'ME';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Portland', state_record.id),
    ('Augusta', state_record.id);

  -- Maryland
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'MD';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Baltimore', state_record.id),
    ('Annapolis', state_record.id);

  -- Massachusetts
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'MA';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Boston', state_record.id),
    ('Worcester', state_record.id),
    ('Springfield', state_record.id),
    ('Cambridge', state_record.id);

  -- Michigan
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'MI';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Detroit', state_record.id),
    ('Grand Rapids', state_record.id),
    ('Ann Arbor', state_record.id);

  -- Minnesota
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'MN';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Minneapolis', state_record.id),
    ('Saint Paul', state_record.id),
    ('Rochester', state_record.id);

  -- Mississippi
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'MS';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Jackson', state_record.id),
    ('Gulfport', state_record.id);

  -- Missouri
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'MO';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Kansas City', state_record.id),
    ('Saint Louis', state_record.id),
    ('Springfield', state_record.id);

  -- Montana
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'MT';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Billings', state_record.id),
    ('Missoula', state_record.id);

  -- Nebraska
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'NE';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Omaha', state_record.id),
    ('Lincoln', state_record.id);

  -- Nevada
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'NV';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Las Vegas', state_record.id),
    ('Reno', state_record.id),
    ('Henderson', state_record.id);

  -- New Hampshire
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'NH';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Manchester', state_record.id),
    ('Nashua', state_record.id);

  -- New Jersey
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'NJ';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Newark', state_record.id),
    ('Jersey City', state_record.id),
    ('Paterson', state_record.id);

  -- New Mexico
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'NM';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Albuquerque', state_record.id),
    ('Santa Fe', state_record.id);

  -- New York
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'NY';
  INSERT INTO us_cities (name, state_id) VALUES
    ('New York City', state_record.id),
    ('Buffalo', state_record.id),
    ('Rochester', state_record.id),
    ('Albany', state_record.id);

  -- North Carolina
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'NC';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Charlotte', state_record.id),
    ('Raleigh', state_record.id),
    ('Greensboro', state_record.id),
    ('Durham', state_record.id);

  -- North Dakota
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'ND';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Fargo', state_record.id),
    ('Bismarck', state_record.id);

  -- Ohio
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'OH';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Columbus', state_record.id),
    ('Cleveland', state_record.id),
    ('Cincinnati', state_record.id),
    ('Toledo', state_record.id);

  -- Oklahoma
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'OK';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Oklahoma City', state_record.id),
    ('Tulsa', state_record.id);

  -- Oregon
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'OR';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Portland', state_record.id),
    ('Eugene', state_record.id),
    ('Salem', state_record.id);

  -- Pennsylvania
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'PA';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Philadelphia', state_record.id),
    ('Pittsburgh', state_record.id),
    ('Allentown', state_record.id),
    ('Harrisburg', state_record.id);

  -- Rhode Island
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'RI';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Providence', state_record.id),
    ('Warwick', state_record.id);

  -- South Carolina
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'SC';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Charleston', state_record.id),
    ('Columbia', state_record.id),
    ('Greenville', state_record.id);

  -- South Dakota
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'SD';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Sioux Falls', state_record.id),
    ('Rapid City', state_record.id);

  -- Tennessee
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'TN';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Nashville', state_record.id),
    ('Memphis', state_record.id),
    ('Knoxville', state_record.id),
    ('Chattanooga', state_record.id);

  -- Texas
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'TX';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Houston', state_record.id),
    ('Dallas', state_record.id),
    ('Austin', state_record.id),
    ('San Antonio', state_record.id),
    ('Fort Worth', state_record.id),
    ('El Paso', state_record.id);

  -- Utah
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'UT';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Salt Lake City', state_record.id),
    ('Provo', state_record.id);

  -- Vermont
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'VT';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Burlington', state_record.id),
    ('Montpelier', state_record.id);

  -- Virginia
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'VA';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Virginia Beach', state_record.id),
    ('Norfolk', state_record.id),
    ('Richmond', state_record.id),
    ('Arlington', state_record.id);

  -- Washington
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'WA';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Seattle', state_record.id),
    ('Spokane', state_record.id),
    ('Tacoma', state_record.id);

  -- West Virginia
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'WV';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Charleston', state_record.id),
    ('Huntington', state_record.id);

  -- Wisconsin
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'WI';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Milwaukee', state_record.id),
    ('Madison', state_record.id),
    ('Green Bay', state_record.id);

  -- Wyoming
  SELECT id INTO state_record FROM us_states WHERE abbreviation = 'WY';
  INSERT INTO us_cities (name, state_id) VALUES
    ('Cheyenne', state_record.id),
    ('Casper', state_record.id);
END $$;

-- Add comment
COMMENT ON TABLE us_cities IS 'List of major cities in the United States organized by state';
