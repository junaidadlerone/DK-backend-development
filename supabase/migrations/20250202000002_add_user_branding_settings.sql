-- Add branding_settings column to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS branding_settings jsonb DEFAULT '{
  "theme": {
    "colors": {
      "primary": "#E36A00",
      "secondary": "#1D1D20",
      "accent": "#47BAD7"
    },
    "fonts": {
      "primary": {
        "name": "Poppins"
      },
      "body": {
        "name": "Poppins"
      }
    }
  }
}'::jsonb;

-- Add comment
COMMENT ON COLUMN profiles.branding_settings IS 'User-specific branding settings including theme colors and fonts';
