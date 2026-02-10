-- Add welcome_email_sent column to profiles table
-- This flag tracks whether a welcome email has been sent to the user
ALTER TABLE profiles
ADD COLUMN welcome_email_sent BOOLEAN NOT NULL DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN profiles.welcome_email_sent IS 'Flag indicating if a welcome email has been sent to this user. Used by sendWelcomeEmail cron job.';

-- Create index for efficient querying by sendWelcomeEmail cron job
CREATE INDEX idx_profiles_welcome_email_pending
ON profiles(created_at)
WHERE welcome_email_sent = false OR welcome_email_sent IS NULL;
