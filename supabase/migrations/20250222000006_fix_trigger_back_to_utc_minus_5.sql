-- Fix trigger back to UTC-5 (was accidentally changed to UTC+5)
-- User confirmed default should be UTC-5 (Eastern US Time) not UTC+5

CREATE OR REPLACE FUNCTION create_default_system_preferences()
RETURNS TRIGGER AS $$
DECLARE
    default_timezone_id UUID;
    default_currency_id UUID;
BEGIN
    -- Try to find UTC-5 (Eastern Time) first
    SELECT id INTO default_timezone_id FROM timezones WHERE symbol = 'UTC-5' LIMIT 1;

    -- Fallback: If UTC-5 not found, pick *any* timezone
    IF default_timezone_id IS NULL THEN
        SELECT id INTO default_timezone_id FROM timezones LIMIT 1;
    END IF;

    -- Try to find USD first
    SELECT id INTO default_currency_id FROM currencies WHERE abbreviation = 'USD' LIMIT 1;

    -- Fallback: If USD not found, pick *any* currency
    IF default_currency_id IS NULL THEN
        SELECT id INTO default_currency_id FROM currencies LIMIT 1;
    END IF;

    -- If we still don't have defaults, just return NEW without creating preferences
    -- This allows user creation to succeed even if preferences can't be created
    IF default_timezone_id IS NULL OR default_currency_id IS NULL THEN
        RAISE WARNING 'Cannot create system preferences for user %: timezone or currency tables are empty', NEW.id;
        RETURN NEW;
    END IF;

    -- Create default preferences for the new user
    -- Use ON CONFLICT DO NOTHING to prevent race conditions
    BEGIN
        INSERT INTO system_preferences (user_id, selected_timezone_id, selected_currency_id)
        VALUES (NEW.id, default_timezone_id, default_currency_id)
        ON CONFLICT (user_id) DO NOTHING;
    EXCEPTION
        WHEN OTHERS THEN
            -- Log the error but don't fail user creation
            RAISE WARNING 'Failed to create system preferences for user %: %', NEW.id, SQLERRM;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
