-- Fix system_preferences trigger by adding service role policy
-- The trigger function uses SECURITY DEFINER but RLS policies were blocking inserts

-- Add policy for service role to manage all preferences (needed for trigger)
CREATE POLICY "Service role can manage all preferences"
  ON system_preferences
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add policy for authenticated users to bypass RLS during trigger execution
-- This allows the trigger function to insert preferences for new users
CREATE POLICY "Allow trigger to create preferences"
  ON system_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
