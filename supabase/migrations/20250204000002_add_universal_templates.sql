-- Add is_universal flag to templates table
ALTER TABLE templates ADD COLUMN IF NOT EXISTS is_universal boolean DEFAULT false;

-- Make organization_id nullable for universal templates
ALTER TABLE templates ALTER COLUMN organization_id DROP NOT NULL;

-- Add check constraint to ensure universal templates have no organization
ALTER TABLE templates ADD CONSTRAINT check_universal_template
  CHECK (
    (is_universal = true AND organization_id IS NULL) OR
    (is_universal = false AND organization_id IS NOT NULL)
  );

-- Create index for universal templates
CREATE INDEX IF NOT EXISTS idx_templates_is_universal ON templates(is_universal);

-- Add comment
COMMENT ON COLUMN templates.is_universal IS 'If true, template is visible to all organizations. If false, template is organization-scoped.';
