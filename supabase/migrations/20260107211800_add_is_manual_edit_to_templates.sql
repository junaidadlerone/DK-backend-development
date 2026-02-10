-- Add isManualEdit column to templates table
-- This flag indicates if a template was manually created/edited (not from a universal template)
ALTER TABLE templates
ADD COLUMN is_manual_edit BOOLEAN NOT NULL DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN templates.is_manual_edit IS 'Flag indicating if template was manually created/edited. Manual edit templates are only shown when querying with specific campaign_id.';
