-- Add consents column to campaigns table to store campaign disclaimers/consents
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS consents jsonb DEFAULT '{}'::jsonb;
