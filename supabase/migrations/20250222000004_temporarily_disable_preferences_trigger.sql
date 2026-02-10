-- Temporarily disable the system preferences trigger to test if it's causing signup failures
-- We'll manually create preferences in the signUp function instead

DROP TRIGGER IF EXISTS on_user_created_create_preferences ON auth.users;
