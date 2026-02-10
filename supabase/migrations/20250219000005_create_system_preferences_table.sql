-- Create system_preferences table
CREATE TABLE IF NOT EXISTS system_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    selected_timezone_id UUID NOT NULL REFERENCES timezones(id),
    selected_currency_id UUID NOT NULL REFERENCES currencies(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE system_preferences ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own preferences
CREATE POLICY "Users can read own preferences" ON system_preferences
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can insert their own preferences
CREATE POLICY "Users can insert own preferences" ON system_preferences
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own preferences
CREATE POLICY "Users can update own preferences" ON system_preferences
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Function to auto-create default preferences for new users
CREATE OR REPLACE FUNCTION create_default_system_preferences()
RETURNS TRIGGER AS $$
DECLARE
    default_timezone_id UUID;
    default_currency_id UUID;
BEGIN
    -- Get UTC-5 Eastern Time timezone ID
    SELECT id INTO default_timezone_id FROM timezones WHERE symbol = 'UTC-5' LIMIT 1;

    -- Get USD currency ID
    SELECT id INTO default_currency_id FROM currencies WHERE abbreviation = 'USD' LIMIT 1;

    -- Create default preferences for the new user
    INSERT INTO system_preferences (user_id, selected_timezone_id, selected_currency_id)
    VALUES (NEW.id, default_timezone_id, default_currency_id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create default preferences when user signs up
CREATE TRIGGER on_user_created_create_preferences
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_default_system_preferences();

-- Create index for faster lookups
CREATE INDEX idx_system_preferences_user_id ON system_preferences(user_id);

-- Backfill: Create default preferences for existing users
DO $$
DECLARE
    user_record RECORD;
    default_timezone_id UUID;
    default_currency_id UUID;
BEGIN
    -- Get default IDs
    SELECT id INTO default_timezone_id FROM timezones WHERE symbol = 'UTC-5' LIMIT 1;
    SELECT id INTO default_currency_id FROM currencies WHERE abbreviation = 'USD' LIMIT 1;

    -- Create preferences for all existing users who don't have them
    FOR user_record IN
        SELECT id FROM auth.users
        WHERE id NOT IN (SELECT user_id FROM system_preferences)
    LOOP
        INSERT INTO system_preferences (user_id, selected_timezone_id, selected_currency_id)
        VALUES (user_record.id, default_timezone_id, default_currency_id)
        ON CONFLICT (user_id) DO NOTHING;
    END LOOP;
END $$;
