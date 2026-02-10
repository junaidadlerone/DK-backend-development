-- Redefine the function with more robust logic
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

    -- Final Check: If tables are completely empty, raise a detailed error
    IF default_timezone_id IS NULL THEN
        RAISE EXCEPTION 'Cannot create user: Timezones table is empty. Please contact support.';
    END IF;
    
    IF default_currency_id IS NULL THEN
        RAISE EXCEPTION 'Cannot create user: Currencies table is empty. Please contact support.';
    END IF;

    -- Create default preferences for the new user
    -- Use ON CONFLICT DO NOTHING to prevent race conditions or unique constraint violations
    INSERT INTO system_preferences (user_id, selected_timezone_id, selected_currency_id)
    VALUES (NEW.id, default_timezone_id, default_currency_id)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
