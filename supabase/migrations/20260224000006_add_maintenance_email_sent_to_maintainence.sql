-- Add maintenance_email_sent column to maintainence table
ALTER TABLE maintainence 
ADD COLUMN IF NOT EXISTS maintenance_email_sent boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN maintainence.maintenance_email_sent IS 'Tracks if maintenance email notification has been sent for the current maintenance window.';
