-- Create enum for template types
CREATE TYPE template_type AS ENUM ('Front', 'Back');

-- Create enum for postcard sizes
CREATE TYPE postcard_size AS ENUM ('4x6', '6x9', '6x11');

-- Create templates table
CREATE TABLE IF NOT EXISTS templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  postgrid_template_id text NOT NULL UNIQUE,
  description text,
  html text NOT NULL,
  template_type template_type NOT NULL,
  postcard_size postcard_size NOT NULL,
  campaigns_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by jsonb NOT NULL,
  live boolean DEFAULT false,
  deleted boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_templates_organization_id ON templates(organization_id);
CREATE INDEX idx_templates_postgrid_id ON templates(postgrid_template_id);
CREATE INDEX idx_templates_template_type ON templates(template_type);
CREATE INDEX idx_templates_postcard_size ON templates(postcard_size);

-- Enable RLS
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

-- Policy: Allow service role full access (for Edge Functions)
CREATE POLICY "Service role has full access to templates"
  ON templates
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_templates_updated_at
  BEFORE UPDATE ON templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comment
COMMENT ON TABLE templates IS 'Stores PostGrid templates with organization and campaign tracking';
