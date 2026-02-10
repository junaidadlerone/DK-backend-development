-- Add created_by field to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_by jsonb;

-- Add comment
COMMENT ON COLUMN profiles.created_by IS 'Information about the user who created this profile (for users created by admins)';
