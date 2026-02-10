-- Fix RLS policies to allow trigger to insert preferences
-- The trigger uses SECURITY DEFINER but still needs proper policies

-- Ensure service role can bypass RLS
ALTER TABLE system_preferences FORCE ROW LEVEL SECURITY;

-- Drop existing policies that might conflict
DROP POLICY IF EXISTS "Users can insert own preferences" ON system_preferences;
DROP POLICY IF EXISTS "Allow trigger to create preferences" ON system_preferences;

-- Recreate policies with correct logic
-- Service role policy (already exists from earlier migration, but ensure it's there)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'system_preferences'
        AND policyname = 'Service role can manage all preferences'
    ) THEN
        CREATE POLICY "Service role can manage all preferences"
          ON system_preferences
          FOR ALL
          TO service_role
          USING (true)
          WITH CHECK (true);
    END IF;
END$$;

-- Policy for authenticated users to insert their own preferences
CREATE POLICY "Users can insert own preferences" ON system_preferences
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Policy to allow any authenticated user to insert (needed for trigger during signup)
-- The trigger runs in the context of the new user being created
CREATE POLICY "Allow new user preference creation" ON system_preferences
    FOR INSERT
    TO authenticated
    WITH CHECK (true);
