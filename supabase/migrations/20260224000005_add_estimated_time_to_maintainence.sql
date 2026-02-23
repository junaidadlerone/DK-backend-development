-- Add estimated_time field to maintainence table
ALTER TABLE maintainence
  ADD COLUMN IF NOT EXISTS estimated_time text NOT NULL DEFAULT '9:00AM EST';

-- Update the existing row to have the default value
UPDATE maintainence SET estimated_time = '9:00AM EST' WHERE estimated_time IS NULL;
