-- Create CompanyLogos storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('CompanyLogos', 'CompanyLogos', true)
ON CONFLICT (id) DO NOTHING;

-- Policy: Public read access
CREATE POLICY "Public read access to CompanyLogos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'CompanyLogos');

-- Policy: Authenticated users can upload logos
CREATE POLICY "Authenticated users can upload logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'CompanyLogos');

-- Policy: Users can update their own logos (optional, based on requirement)
CREATE POLICY "Users can update their logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'CompanyLogos');

-- Policy: Users can delete their logos
CREATE POLICY "Users can delete their logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'CompanyLogos');
