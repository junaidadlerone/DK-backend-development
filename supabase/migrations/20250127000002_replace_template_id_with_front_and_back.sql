-- Replace template_id with front_template_id and back_template_id in campaigns table

-- Add new columns
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS front_template_id text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS back_template_id text;

-- Migrate existing data if template_id exists
UPDATE campaigns
SET front_template_id = template_id,
    back_template_id = template_id
WHERE template_id IS NOT NULL
  AND (front_template_id IS NULL OR back_template_id IS NULL);

-- Drop old column
ALTER TABLE campaigns DROP COLUMN IF EXISTS template_id;

-- Add comments
COMMENT ON COLUMN campaigns.front_template_id IS 'PostGrid template ID for front of postcard (Step 2)';
COMMENT ON COLUMN campaigns.back_template_id IS 'PostGrid template ID for back of postcard (Step 2)';
