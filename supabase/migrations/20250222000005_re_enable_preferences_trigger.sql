-- Re-enable the system preferences trigger
-- The signup issue was due to shell escaping, not the trigger

CREATE TRIGGER on_user_created_create_preferences
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_default_system_preferences();
