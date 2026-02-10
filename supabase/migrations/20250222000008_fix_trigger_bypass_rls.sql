-- Fix trigger to properly bypass RLS
-- The issue is that SECURITY DEFINER alone doesn't bypass RLS
-- We need to use SECURITY DEFINER with SET ROLE or grant proper permissions

-- Grant necessary permissions to the postgres role for the function
GRANT INSERT ON system_preferences TO postgres;

-- Recreate the function with proper RLS bypass
CREATE OR REPLACE FUNCTION create_default_system_preferences()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    default_timezone_id UUID;
    default_currency_id UUID;
BEGIN
    -- Try to find UTC-5 (Eastern Time) first
    SELECT id INTO default_timezone_id FROM public.timezones WHERE symbol = 'UTC-5' LIMIT 1;

    -- Fallback: If UTC-5 not found, pick *any* timezone
    IF default_timezone_id IS NULL THEN
        SELECT id INTO default_timezone_id FROM public.timezones LIMIT 1;
    END IF;

    -- Try to find USD first
    SELECT id INTO default_currency_id FROM public.currencies WHERE abbreviation = 'USD' LIMIT 1;

    -- Fallback: If USD not found, pick *any* currency
    IF default_currency_id IS NULL THEN
        SELECT id INTO default_currency_id FROM public.currencies LIMIT 1;
    END IF;

    -- If we still don't have defaults, just return NEW without creating preferences
    -- This allows user creation to succeed even if preferences can't be created
    IF default_timezone_id IS NULL OR default_currency_id IS NULL THEN
        RAISE WARNING 'Cannot create system preferences for user %: timezone or currency tables are empty', NEW.id;
        RETURN NEW;
    END IF;

    -- Create default preferences for the new user
    -- Insert directly without RLS check since this function is SECURITY DEFINER
    BEGIN
        INSERT INTO public.system_preferences (user_id, selected_timezone_id, selected_currency_id)
        VALUES (NEW.id, default_timezone_id, default_currency_id)
        ON CONFLICT (user_id) DO NOTHING;
    EXCEPTION
        WHEN OTHERS THEN
            -- Log the error but don't fail user creation
            RAISE WARNING 'Failed to create system preferences for user %: %', NEW.id, SQLERRM;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure the function owner has proper permissions
ALTER FUNCTION create_default_system_preferences() OWNER TO postgres;
