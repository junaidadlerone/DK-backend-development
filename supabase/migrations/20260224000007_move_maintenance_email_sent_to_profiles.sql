-- Add maintenance_email_sent column to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS maintenance_email_sent boolean NOT NULL DEFAULT true;

-- Add comment for documentation
COMMENT ON COLUMN profiles.maintenance_email_sent IS 'Tracks if maintenance email notification has been sent to the user for the current maintenance window.';

-- Remove the incorrectly added column from maintainence table
ALTER TABLE maintainence 
DROP COLUMN IF EXISTS maintenance_email_sent;
