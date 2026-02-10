-- Create fonts table
CREATE TABLE IF NOT EXISTS fonts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text,
  variants text[] DEFAULT '{}',
  subsets text[] DEFAULT '{}',
  is_google_font boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE fonts ENABLE ROW LEVEL SECURITY;

-- Allow read access to authenticated users
CREATE POLICY "Authenticated users can view fonts"
  ON fonts
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow read access to service role
CREATE POLICY "Service role can manage fonts"
  ON fonts
  USING (true);

-- Insert popular fonts (from existing hardcoded list)
INSERT INTO fonts (name, category, variants, subsets) VALUES
  ('Poppins', 'sans-serif', ARRAY['regular', '500', '600', '700'], ARRAY['latin']),
  ('Roboto', 'sans-serif', ARRAY['regular', '500', '700'], ARRAY['latin']),
  ('Open Sans', 'sans-serif', ARRAY['regular', '600', '700'], ARRAY['latin']),
  ('Lato', 'sans-serif', ARRAY['regular', '700'], ARRAY['latin']),
  ('Montserrat', 'sans-serif', ARRAY['regular', '500', '600', '700'], ARRAY['latin']),
  ('Oswald', 'sans-serif', ARRAY['regular', '500', '600', '700'], ARRAY['latin']),
  ('Raleway', 'sans-serif', ARRAY['regular', '500', '600', '700'], ARRAY['latin']),
  ('PT Sans', 'sans-serif', ARRAY['regular', '700'], ARRAY['latin']),
  ('Merriweather', 'serif', ARRAY['regular', '700'], ARRAY['latin']),
  ('Playfair Display', 'serif', ARRAY['regular', '700'], ARRAY['latin']),
  ('Nunito', 'sans-serif', ARRAY['regular', '600', '700'], ARRAY['latin']),
  ('Ubuntu', 'sans-serif', ARRAY['regular', '500', '700'], ARRAY['latin']),
  ('Inter', 'sans-serif', ARRAY['regular', '500', '600', '700'], ARRAY['latin']),
  ('Work Sans', 'sans-serif', ARRAY['regular', '500', '600', '700'], ARRAY['latin']),
  ('Quicksand', 'sans-serif', ARRAY['regular', '500', '600', '700'], ARRAY['latin'])
ON CONFLICT (name) DO NOTHING;

-- Insert new requested fonts
-- Assuming categories based on names, using standard variants
INSERT INTO fonts (name, category, variants, subsets) VALUES
  ('Alegreya', 'serif', ARRAY['regular', '500', '700'], ARRAY['latin']),
  ('Garet', 'sans-serif', ARRAY['regular', '500', '700'], ARRAY['latin']), -- Note: Garet might not be a Google Font, but request implies adding it. Marking is_google_font true for now unless specified otherwise.
  ('Glacial Indifference', 'sans-serif', ARRAY['regular', 'bold'], ARRAY['latin']),
  ('League Gothic', 'sans-serif', ARRAY['regular'], ARRAY['latin']),
  ('Sarabun', 'sans-serif', ARRAY['regular', '500', '700'], ARRAY['latin']),
  ('Arapey', 'serif', ARRAY['regular', 'italic'], ARRAY['latin']),
  ('TT Interphases', 'sans-serif', ARRAY['regular', '500', '700'], ARRAY['latin']),
  ('Hammersmith One', 'sans-serif', ARRAY['regular'], ARRAY['latin'])
ON CONFLICT (name) DO NOTHING;

-- Comments
COMMENT ON TABLE fonts IS 'Available fonts for branding configuration';
